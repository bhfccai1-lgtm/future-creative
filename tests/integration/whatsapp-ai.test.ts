import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { setSecret, updateSettings } from '@/lib/settings';
import { setAiProviderOverride } from '@/lib/ai';
import { handleInbound, parseInbound, verifyMetaSignature } from '@/lib/integrations/whatsapp-cloud';
import { POST as webhook } from '@/app/api/webhooks/whatsapp/route';
import { captured, captureQueues, FakeAiProvider, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const OWNER = '97336000000', CUSTOMER = '97339111222';
const msg = (from: string, id: string, text: string, name = 'Ali') => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id, type: 'text', text: { body: text } }] } }] }] });
async function setup() {
  const base = await seedBase();
  await updateSettings((s) => ({ ...s, whatsapp: { ...s.whatsapp, cloud: { ...s.whatsapp.cloud, enabled: true, phoneNumberId: '123', ownerNumbers: [OWNER], autoAck: true } } }));
  const sent: { to: string; text: string }[] = [];
  return { ...base, sent, send: async (to: string, text: string) => { sent.push({ to, text }); } };
}
class ScriptedAi extends FakeAiProvider {
  constructor(private steps: unknown[]) { super(); }
  async generateJson() { return { json: this.steps.shift() ?? { tool: null, reply: 'تمام' }, usage: { inputTokens: 500, outputTokens: 50 }, model: 'fake-text' }; }
}

describe('WhatsApp AI (Cloud API)', () => {
  it('Meta signatures are verified; text messages are parsed', () => {
    const raw = JSON.stringify(msg(CUSTOMER, 'm1', 'هلا'));
    const sig = 'sha256=' + createHmac('sha256', 'a'.repeat(32)).update(raw).digest('hex');
    expect(verifyMetaSignature(raw, sig, 'a'.repeat(32))).toBe(true);
    expect(verifyMetaSignature(raw, sig, 'b'.repeat(32))).toBe(false);
    expect(verifyMetaSignature(raw, null, 'a'.repeat(32))).toBe(false);
    expect(parseInbound(JSON.parse(raw))).toEqual([{ from: CUSTOMER, id: 'm1', text: 'هلا', name: 'Ali' }]);
  });

  it('a customer becomes a lead (once), later messages are added to it, the welcome is sent once, duplicates are ignored', async () => {
    const { send, sent } = await setup();
    await handleInbound(msg(CUSTOMER, 'c1', 'أبي ١٠٠ كوب مطبوع بشعار شركتي'), send);
    await handleInbound(msg(CUSTOMER, 'c1', 'أبي ١٠٠ كوب مطبوع بشعار شركتي'), send); // Meta retry
    await handleInbound(msg(CUSTOMER, 'c2', 'متى يجهز؟'), send);
    const leads = await prisma.lead.findMany();
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ source: 'whatsapp', contact: `+${CUSTOMER}`, name: 'Ali' });
    expect(leads[0].notes).toMatch(/١٠٠ كوب[\s\S]*متى يجهز/);
    expect(sent.filter((x) => x.to === CUSTOMER)).toHaveLength(1); // welcome once per 24 h
    expect(await prisma.notification.count({ where: { code: 'WA_NEW_CUSTOMER' } })).toBe(1);
  });

  it('the owner talks to the assistant; an action runs only after «تأكيد»', async () => {
    const { send, sent, accounts } = await setup();
    setAiProviderOverride(new ScriptedAi([{ tool: { name: 'design_now', args: { account: accounts[0].name, idea: 'ستوري عن لوحات الترحيب', format: 'IMAGE_STORY' } }, reply: 'جهزت لك الطلب.' }]));
    await handleInbound(msg(OWNER, 'o1', 'صمم ستوري عن لوحات الترحيب'), send);
    expect(sent.at(-1)!.text).toMatch(/رد بكلمة «تأكيد»/);
    expect(captured.generate).toHaveLength(0);
    await handleInbound(msg(OWNER, 'o2', 'تأكيد'), send);
    expect(captured.generate).toHaveLength(1);
    expect(sent.at(-1)!.text).toMatch(/طابور الموافقات/);
    await handleInbound(msg(OWNER, 'o3', 'تأكيد'), send);
    expect(sent.at(-1)!.text).toMatch(/ما عندي طلب/);
    expect(await prisma.lead.count()).toBe(0); // the owner is never a customer
  });

  it('the webhook refuses unsigned or wrongly signed deliveries', async () => {
    await setup(); await setSecret('WA_APP_SECRET', 'c'.repeat(32), 't');
    const raw = JSON.stringify(msg(CUSTOMER, 'w1', 'هلا'));
    expect((await webhook(new Request('http://x/api/webhooks/whatsapp', { method: 'POST', body: raw }))).status).toBe(403);
    const bad = 'sha256=' + createHmac('sha256', 'd'.repeat(32)).update(raw).digest('hex');
    expect((await webhook(new Request('http://x/api/webhooks/whatsapp', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': bad } }))).status).toBe(403);
    const good = 'sha256=' + createHmac('sha256', 'c'.repeat(32)).update(raw).digest('hex');
    expect((await webhook(new Request('http://x/api/webhooks/whatsapp', { method: 'POST', body: raw, headers: { 'x-hub-signature-256': good } }))).status).toBe(200);
    expect(await prisma.lead.count()).toBe(1);
  });
});
