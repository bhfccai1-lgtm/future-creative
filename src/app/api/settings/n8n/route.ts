import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { getSettings, secretStatus, setSecret, updateSettings } from '@/lib/settings';
import { AppError } from '@/lib/errors';
import { audit } from '@/lib/audit';
import { EVENTS } from '@/lib/integrations/events';

const Body = z.object({
  enabled: z.boolean(),
  webhookUrl: z.string().max(500).refine((u) => u === '' || /^https?:\/\/[^\s]+$/.test(u), 'رابط غير صالح'),
  events: z.array(z.enum(Object.keys(EVENTS) as [string, ...string[]])).max(20),
  allowInboundApprovals: z.boolean(),
  allowInboundGeneration: z.boolean(),
  allowInboundControl: z.boolean().default(false),
  approvalReminderHours: z.number().int().min(0).max(72).default(6),
  telegramChatId: z.string().regex(/^-?\d*$/).max(30).default(''),
  telegramAllowedUserIds: z.string().regex(/^[\d,\s]*$/).max(300).default(''),
  telegramBotToken: z.string().max(200).optional(), // write-only; '__delete__' removes
});
const status = async () => ({ secret: (await secretStatus('N8N_WEBHOOK_SECRET')).configured, token: (await secretStatus('N8N_API_TOKEN')).configured, telegram: (await secretStatus('TELEGRAM_BOT_TOKEN')).configured });

export const GET = api('settings:integrations', async () => NextResponse.json({ n8n: (await getSettings()).n8n, ...(await status()) }));
export const PUT = api('settings:integrations', async (req, { user }) => {
  const { telegramBotToken, ...b } = Body.parse(await req.json());
  if (telegramBotToken === '__delete__') await setSecret('TELEGRAM_BOT_TOKEN', null, user.email);
  else if (telegramBotToken?.trim()) {
    if (!/^\d{5,}:[\w-]{20,}$/.test(telegramBotToken.trim())) throw new AppError('VALIDATION', 'رمز البوت غير صحيح — انسخه كاملًا من @BotFather (أرقام ثم : ثم حروف).', 422);
    await setSecret('TELEGRAM_BOT_TOKEN', telegramBotToken.trim(), user.email);
  }
  const s = await updateSettings((x) => ({ ...x, n8n: { ...x.n8n, ...b, telegramAllowedUserIds: b.telegramAllowedUserIds.replace(/\s+/g, '') } }), user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'settings.n8n.update', details: { enabled: b.enabled, events: b.events, approvals: b.allowInboundApprovals, generation: b.allowInboundGeneration } });
  return NextResponse.json({ n8n: s.n8n, ...(await status()) });
});
