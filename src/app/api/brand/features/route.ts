import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { updateSettings } from '@/lib/settings';
import { audit } from '@/lib/audit';
import { findClaims } from '@/lib/qc/checks';
import { AppError } from '@/lib/errors';

const list = (max: number) => z.array(z.string().trim().min(2).max(max)).max(4);
const Body = z.object({ ar: list(24), en: list(24), ml: list(32) });

/** Benefit badges shown on the gold poster. Admin-approved wording; prices/delivery-time claims are rejected. */
export const PUT = api('brand:manage', async (req, { user }) => {
  const b = Body.parse(await req.json());
  const claims = [...b.ar, ...b.en, ...b.ml].flatMap(findClaims);
  if (claims.length) throw new AppError('CLAIMS', `لا يمكن استخدام ادعاءات غير موثقة في المزايا: ${claims.join('، ')}`, 422);
  const s = await updateSettings((x) => ({ ...x, brandFeatures: b }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'brand.features.update', details: b });
  return NextResponse.json(s.brandFeatures);
});
