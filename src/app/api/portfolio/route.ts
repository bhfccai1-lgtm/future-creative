import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { enq } from '@/lib/queue/queues';
import { saveReference } from '@/lib/creative/references';
import { getSettings } from '@/lib/settings';
import { stripBanned } from '@/lib/creative/banned';

const Fields = z.object({
  accountIds: z.array(z.string().max(60)).min(1).max(20),
  productId: z.string().max(60).optional(),
  format: z.enum(['IMAGE_STORY', 'IMAGE_FEED', 'IMAGE_SQUARE', 'REEL_VIDEO']).default('IMAGE_FEED'),
  note: z.string().trim().max(300).default(''),
  clientConsent: z.boolean().default(false),
});

/** «أعمال منجزة»: a real photo of a delivered job → one branded post per chosen account, each waiting for approval. */
export const POST = api('ads:create', async (req, { user }) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new AppError('NO_FILE', 'أرفق صورة العمل المنجز.', 422);
  const f = Fields.parse({
    accountIds: String(form.get('accountIds') ?? '').split(',').filter(Boolean), productId: String(form.get('productId') ?? '') || undefined,
    format: String(form.get('format') ?? 'IMAGE_FEED'), note: String(form.get('note') ?? ''), clientConsent: form.get('clientConsent') === 'true',
  });
  const accounts = await prisma.socialAccount.findMany({ where: { id: { in: f.accountIds } }, select: { id: true, name: true } });
  if (!accounts.length) throw new AppError('NO_ACCOUNT', 'اختر حسابًا واحدًا على الأقل.', 422);
  const id = crypto.randomUUID();
  const key = await saveReference('work', id, Buffer.from(await file.arrayBuffer()));
  const s = await getSettings();
  const note = stripBanned(f.note, s.ai.bannedPhrases);
  // the client is named only with their permission; otherwise the copy must stay anonymous
  const idea = [`أعمال منجزة — صورة حقيقية لعمل سلّمناه${note ? `: ${note}` : ''}.`, f.clientConsent ? 'يُسمح بذكر اسم العميل كما ورد.' : 'لا تذكر اسم العميل أو شركته — قل «لأحد عملائنا».'].join(' ');
  for (const a of accounts) {
    await enq.generate({ accountId: a.id, productId: f.productId, format: f.format, direction: { realPhotoKey: key, idea, contentType: 'real_work', renderMode: 'layered' }, createdBy: user.email }, `work-${id}-${a.id}`);
  }
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'portfolio.create', details: { key, accounts: accounts.map((a) => a.name), format: f.format, clientConsent: f.clientConsent } });
  return NextResponse.json({ ok: true, message: `جاري تجهيز ${accounts.length} منشور من صورتك — تظهر في طابور الموافقات خلال دقيقة تقريبًا ✓` }, { status: 201 });
});
