import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { audit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { getSecret, getSettings, secretStatus, setSecret, updateSettings } from '@/lib/settings';
import { normalizeWaPhone } from '@/lib/integrations/whatsapp-numbers';
import { sendWhatsappText } from '@/lib/integrations/whatsapp-cloud';

/** WhatsApp Cloud API settings: what the owner copies into Meta (webhook URL + verify token) and the status */
export const GET = api('settings:integrations', async (req) => {
  let verify = await getSecret('WA_VERIFY_TOKEN');
  if (!verify) { verify = randomBytes(18).toString('base64url'); await setSecret('WA_VERIFY_TOKEN', verify, 'system'); }
  const host = process.env.DOMAIN || new URL(req.url).host;
  return NextResponse.json({
    cloud: (await getSettings()).whatsapp.cloud, webhookUrl: `https://${host}/api/webhooks/whatsapp`, verifyToken: verify,
    token: (await secretStatus('WA_CLOUD_TOKEN')).configured, appSecret: (await secretStatus('WA_APP_SECRET')).configured,
  });
});

const Body = z.object({
  enabled: z.boolean(), phoneNumberId: z.string().regex(/^\d*$/).max(30), ownerNumbers: z.array(z.string().max(20)).max(5),
  autoAck: z.boolean(), ackText: z.string().min(5).max(600), token: z.string().max(600).optional(), appSecret: z.string().max(100).optional(),
});
export const PUT = api('settings:integrations', async (req, { user }) => {
  const b = Body.parse(await req.json());
  if (b.token?.trim()) await setSecret('WA_CLOUD_TOKEN', b.token.trim(), user.email);
  if (b.appSecret?.trim()) { if (!/^[a-f0-9]{32}$/i.test(b.appSecret.trim())) throw new AppError('VALIDATION', 'App Secret غير صحيح — ٣٢ حرفًا من لوحة Meta ← App settings ← Basic.', 422); await setSecret('WA_APP_SECRET', b.appSecret.trim(), user.email); }
  const owners = b.ownerNumbers.map((n) => { const d = normalizeWaPhone(n); if (!d) throw new AppError('VALIDATION', `الرقم «${n}» غير صحيح`, 422); return d; });
  if (b.enabled && (!b.phoneNumberId || !(await getSecret('WA_CLOUD_TOKEN')) || !(await getSecret('WA_APP_SECRET')))) throw new AppError('INCOMPLETE', 'للتفعيل: Phone number ID ورمز الوصول وApp Secret مطلوبة.', 422);
  const s = await updateSettings((x) => ({ ...x, whatsapp: { ...x.whatsapp, cloud: { ...x.whatsapp.cloud, enabled: b.enabled, phoneNumberId: b.phoneNumberId, ownerNumbers: owners, autoAck: b.autoAck, ackText: b.ackText } } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.whatsapp_cloud', details: { enabled: b.enabled, owners: owners.length, autoAck: b.autoAck, tokenChanged: !!b.token, secretChanged: !!b.appSecret } });
  return NextResponse.json({ cloud: s.whatsapp.cloud });
});

/** «رسالة تجربة»: sends a test message to the first owner number */
export const POST = api('settings:integrations', async () => {
  const c = (await getSettings()).whatsapp.cloud;
  if (!c.ownerNumbers[0]) throw new AppError('NO_OWNER', 'أضف رقمك في «أرقام المالك» أولًا.', 422);
  const r = await sendWhatsappText(c.ownerNumbers[0], 'هلا والله 👋 هذي رسالة تجربة من نظام إبداع المستقبل. اكتب لي مثلًا: «شنو وضع النظام؟»');
  if (!r.ok) throw new AppError('SEND_FAILED', `لم تُرسل الرسالة (${r.reason}). تأكد من الرمز ورقم الهاتف، وأن رقمك أرسل رسالة للرقم التجاري خلال آخر ٢٤ ساعة.`, 502);
  return NextResponse.json({ ok: true });
});
