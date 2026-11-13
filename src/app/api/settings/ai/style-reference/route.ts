import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { updateSettings } from '@/lib/settings';
import { saveReference } from '@/lib/creative/references';

/** The reference design every full-AI poster follows (style & quality level, never its texts). */
export const POST = api('settings:ai', async (req, { user }) => {
  const file = (await req.formData()).get('file');
  if (!(file instanceof File)) throw new AppError('NO_FILE', 'لم يتم إرفاق صورة.', 422);
  const key = await saveReference('style', 'design', Buffer.from(await file.arrayBuffer()));
  await updateSettings((s) => ({ ...s, ai: { ...s.ai, styleReferenceKey: key } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.ai.style_reference', details: { key } });
  return NextResponse.json({ styleReferenceKey: key }, { status: 201 });
});

export const DELETE = api('settings:ai', async (_req, { user }) => {
  await updateSettings((s) => ({ ...s, ai: { ...s.ai, styleReferenceKey: null } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.ai.style_reference', details: { removed: true } });
  return NextResponse.json({ ok: true });
});
