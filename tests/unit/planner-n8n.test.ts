import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { activeOccasions, pickContentType, pickOccasion, marketOf } from '@/lib/creative/planner';
import { captionIssues } from '@/lib/creative/caption-quality';
import { sign } from '@/lib/integrations/events';
import { CONTENT_TYPES } from '@/lib/creative/options';

const at = (s: string) => new Date(`${s}T10:00:00+03:00`);

describe('seasonal content planner', () => {
  it('Bahrain National Day near the peak for Bahraini accounts, never for the KSA account', () => {
    expect(pickOccasion(at('2026-12-14'), { language: 'ar', market: 'BH' }, () => 0.5)).toBe('bahrain_national_day');
    expect(activeOccasions(at('2026-12-14'), { language: 'ar', market: 'KSA' }).map((w) => w.key)).not.toContain('bahrain_national_day');
    expect(pickOccasion(at('2027-09-21'), { language: 'ar', market: 'KSA' }, () => 0.5)).toBe('saudi_national_day');
    expect(marketOf({ name: 'Ksafcc', handle: 'bhfcc.ksa' })).toBe('KSA');
    expect(marketOf({ name: 'bhfcc.mugs' })).toBe('BH');
  });
  it('lunar and community occasions (Ramadan, Eid, Diwali for Malayalam)', () => {
    expect(activeOccasions(at('2027-02-10'), { language: 'ar', market: 'BH' })[0].key).toBe('ramadan');
    expect(activeOccasions(at('2027-03-08'), { language: 'ar', market: 'BH' }).map((w) => w.key)).toContain('eid_fitr');
    expect(activeOccasions(at('2027-10-27'), { language: 'ml', market: 'BH' }).map((w) => w.key)).toContain('diwali');
    expect(activeOccasions(at('2027-10-27'), { language: 'ar', market: 'BH' }).map((w) => w.key)).not.toContain('diwali');
  });
  it('keeps feeds varied: far from the peak most posts stay everyday', () => {
    expect(pickOccasion(at('2026-12-02'), { language: 'ar', market: 'BH' }, () => 0.9)).toBeNull();
    expect(pickOccasion(at('2026-07-25'), { language: 'ar', market: 'BH' }, () => 0)).toBeNull(); // no season active
  });
  it('content angle never repeats one of the last three', () => {
    const recent = CONTENT_TYPES.slice(0, 3).map((c) => c.value);
    for (let i = 0; i < 20; i++) expect(recent).not.toContain(pickContentType(recent, () => i / 20));
  });
});

describe('caption quality (advisory)', () => {
  it('flags long hooks, >5 hashtags, missing CTA; passes a good caption', () => {
    expect(captionIssues('كوبك يحكي قصتك ☕\nاسمك وعبارتك على كوب خاص\nأرسله لصديقك اللي يستاهل\nأرسل كلمة «كوب» على الخاص', { cta: 'اطلب الآن', hashtags: ['#البحرين', '#طباعة_أكواب'] })).toEqual([]);
    const bad = captionIssues('ا'.repeat(140) + '\nسطر', { cta: 'اطلب الآن', hashtags: Array.from({ length: 8 }, (_, i) => `#t${i}`) });
    expect(bad.join(' ')).toMatch(/السطر الأول طويل/); expect(bad.join(' ')).toMatch(/8 وسمًا/); expect(bad.join(' ')).toMatch(/دعوة/);
  });
});

describe('n8n template ↔ server signature compatibility', () => {
  const wf = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../deploy/n8n/01-events-to-telegram.json'), 'utf8'));
  const code: string = wf.nodes.find((n: { name: string }) => n.name === 'Verify & de-duplicate').parameters.jsCode;
  const staticData: Record<string, unknown> = {};
  const run = (headers: Record<string, string>, body: unknown, secret = 's3cret') => {
    const fn = new Function('require', '$env', '$input', '$getWorkflowStaticData', `return (async () => { ${code} })();`);
    return fn(createRequire(__filename), { FC_WEBHOOK_SECRET: secret }, { all: () => [{ json: { headers, body } }] }, () => staticData);
  };
  const payload = { id: 'x', event: 'ad.ready_for_review', title: 'تصميم جديد', data: { headline: 'كوبك بتصميمك', n: 1.5 } };
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  it('accepts a correctly signed event (Arabic payload)', async () => {
    const out = await run({ 'x-fc-timestamp': ts, 'x-fc-signature': sign('s3cret', ts, body), 'x-fc-delivery': 'd1' }, JSON.parse(body));
    expect(out[0].json).toMatchObject({ event: 'ad.ready_for_review', deliveryId: 'd1' });
    // the same delivery again (redelivery/retry) is ignored
    expect(await run({ 'x-fc-timestamp': ts, 'x-fc-signature': sign('s3cret', ts, body), 'x-fc-delivery': 'd1' }, JSON.parse(body))).toEqual([]);
  });
  it('rejects tampered, wrongly signed and replayed events', async () => {
    await expect(run({ 'x-fc-timestamp': ts, 'x-fc-signature': sign('s3cret', ts, body) }, { ...payload, event: 'publication.published' })).rejects.toThrow(/signature/);
    await expect(run({ 'x-fc-timestamp': ts, 'x-fc-signature': sign('other', ts, body) }, payload)).rejects.toThrow(/signature/);
    const old = String(Number(ts) - 3600);
    await expect(run({ 'x-fc-timestamp': old, 'x-fc-signature': sign('s3cret', old, body) }, payload)).rejects.toThrow(/Stale/);
  });
  it('all templates are valid n8n workflow JSON with connected nodes', () => {
    for (const f of fs.readdirSync(path.resolve(__dirname, '../../deploy/n8n')).filter((x) => x.endsWith('.json'))) {
      const w = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../deploy/n8n', f), 'utf8'));
      expect(w.nodes.length).toBeGreaterThanOrEqual(2);
      const names = new Set(w.nodes.map((n: { name: string }) => n.name));
      for (const [from, c] of Object.entries(w.connections) as [string, { main: { node: string }[][] }][]) { expect(names.has(from)).toBe(true); expect(names.has(c.main[0][0].node)).toBe(true); }
      expect(JSON.stringify(w)).not.toMatch(/fcn8n_|fcwhs_|bot\d{6,}:/); // no secrets in templates
      if (!w.name.startsWith('FC — Error')) expect(w.settings.errorWorkflow).toBe('ee8f61980fec7152'); // failures alert via the error workflow
    }
  });
});
