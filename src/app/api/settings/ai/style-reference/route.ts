import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { getSettings, updateSettings } from '@/lib/settings';
import { getAiProvider } from '@/lib/ai';
import { assertBudget, estimateTextCost, recordUsage } from '@/lib/ai/cost';
import { storage } from '@/lib/storage';
import { saveReference } from '@/lib/creative/references';

/** The reference design every full-AI poster follows (style & quality level, never its texts). */
export const POST = api('settings:ai', async (req, { user }) => {
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) throw new AppError('NO_FILE', 'لم يتم إرفاق صورة.', 422);
  const key = await saveReference('style', 'design', Buffer.from(await file.arrayBuffer()));
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
  await updateSettings((s) => ({ ...s, ai: { ...s.ai, styleReferenceKey: key, styleReferenceBrief: brief } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.ai.style_reference', details: { key } });
  return NextResponse.json({ styleReferenceKey: key, styleReferenceBrief: brief }, { status: 201 });
});

export const DELETE = api('settings:ai', async (_req, { user }) => {
  await updateSettings((s) => ({ ...s, ai: { ...s.ai, styleReferenceKey: null, styleReferenceBrief: '' } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.ai.style_reference', details: { removed: true } });
  return NextResponse.json({ ok: true });
});
