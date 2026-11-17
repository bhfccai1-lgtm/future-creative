import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { getSettings, updateSettings } from '@/lib/settings';
import { getAiProvider } from '@/lib/ai';
import { assertBudget, estimateTextCost, recordUsage } from '@/lib/ai/cost';
import { storage } from '@/lib/storage';
import { saveReference, STYLE_SLOTS, type StyleSlot } from '@/lib/creative/references';

const slotOf = (req: Request): StyleSlot | null => { const v = new URL(req.url).searchParams.get('slot'); return (STYLE_SLOTS as readonly string[]).includes(v ?? '') ? (v as StyleSlot) : null; };

/** The reference design full-AI posters follow (style & quality level, never its texts) — general, or per format via ?slot=. */
export const POST = api('settings:ai', async (req, { user }) => {
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) throw new AppError('NO_FILE', 'لم يتم إرفاق صورة.', 422);
  const slot = slotOf(req);
  const key = await saveReference('style', slot ?? 'design', Buffer.from(await file.arrayBuffer()));
  // the style is turned into words once: only this description guides the posters, so the reference's own
  // texts/products/characters can never leak into new designs
  const s0 = await getSettings();
  const provider = await getAiProvider(s0);
  let brief = '';
  if (!provider.isDryRun && provider.describeStyle) {
    await assertBudget(s0, estimateTextCost(s0, 1500, 250));
    const r = await provider.describeStyle(await storage().get(key), s0.ai.textModel);
    await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s0, r.usage.inputTokens, r.usage.outputTokens) });
    brief = r.text;
  }
  await updateSettings((s) => ({ ...s, ai: slot ? { ...s.ai, styleRefsByFormat: { ...s.ai.styleRefsByFormat, [slot]: { key, brief } } } : { ...s.ai, styleReferenceKey: key, styleReferenceBrief: brief } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.ai.style_reference', details: { key, slot: slot ?? 'general' } });
  return NextResponse.json({ key, brief }, { status: 201 });
});

export const DELETE = api('settings:ai', async (req, { user }) => {
  const slot = slotOf(req);
  await updateSettings((s) => { const rest = { ...s.ai.styleRefsByFormat }; if (slot) delete rest[slot]; return { ...s, ai: slot ? { ...s.ai, styleRefsByFormat: rest } : { ...s.ai, styleReferenceKey: null, styleReferenceBrief: '' } }; }, user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.ai.style_reference', details: { removed: true, slot: slot ?? 'general' } });
  return NextResponse.json({ ok: true });
});
