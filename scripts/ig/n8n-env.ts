/**
 * Helper for scripts/n8n-setup.sh (runs inside the worker container):
 *   --enable : create the n8n signing secret / API token if missing, set the default webhook URL, enable n8n,
 *              then print KEY=VALUE lines for the n8n container's .env (stdout only — never logged).
 *   --test   : send a signed test.ping now and print the delivery result.
 * Secrets are read from the encrypted settings, so the operator never has to type them in a console.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../../src/lib/db';
import { getSecret, getSettings, setSecret, updateSettings } from '../../src/lib/settings';
import { emitEvent, deliverPending } from '../../src/lib/integrations/events';
import { closeRedis } from '../../src/lib/queue/connection';
import { audit } from '../../src/lib/audit';

async function main() {
  if (process.argv.includes('--test')) {
    const d = await emitEvent('test.ping', { message: 'اختبار من سكربت الإعداد' });
    if (!d) { console.log('TEST=NOT_ENABLED'); return; }
    await deliverPending();
    const r = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    console.log(`TEST=${r.status} HTTP=${r.lastStatus ?? '-'} ${r.lastError ?? ''}`.trim());
    return;
  }
  if (!(await getSecret('N8N_WEBHOOK_SECRET'))) await setSecret('N8N_WEBHOOK_SECRET', 'fcwhs_' + randomBytes(32).toString('base64url'), 'n8n-setup');
  if (!(await getSecret('N8N_API_TOKEN'))) await setSecret('N8N_API_TOKEN', 'fcn8n_' + randomBytes(32).toString('base64url'), 'n8n-setup');
  if (process.argv.includes('--enable')) {
    await updateSettings((s) => ({ ...s, n8n: { ...s.n8n, enabled: true, webhookUrl: s.n8n.webhookUrl || 'http://n8n:5678/webhook/future-creative' } }), 'n8n-setup');
    await audit({ actorLabel: 'n8n-setup', action: 'settings.n8n.setup' });
  }
  const s = await getSettings();
  const lines: [string, string][] = [
    ['FC_WEBHOOK_SECRET', (await getSecret('N8N_WEBHOOK_SECRET')) ?? ''],
    ['FC_API_TOKEN', (await getSecret('N8N_API_TOKEN')) ?? ''],
    ['TELEGRAM_BOT_TOKEN', (await getSecret('TELEGRAM_BOT_TOKEN')) ?? ''],
    ['TELEGRAM_CHAT_ID', s.n8n.telegramChatId],
    ['TELEGRAM_ALLOWED_USER_IDS', s.n8n.telegramAllowedUserIds],
  ];
  for (const [k, v] of lines) if (/^[\w:.,-]*$/.test(v)) console.log(`${k}=${v}`); // only safe characters ever reach .env
}
main().catch((e) => { console.error(`error: ${(e as Error).message}`); process.exitCode = 1; })
  .finally(async () => { await closeRedis(); await prisma.$disconnect(); });
