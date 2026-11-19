import type { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { audit } from '../audit';
import { AppError } from '../errors';
import { getBusiness, contactLines } from '../business';
import { updateLead } from '../leads/service';
import { waLink } from '../leads/scripts';
import { loadPrint } from './service';

/**
 * PRODUCTION TRACKING after approval: queued → printing → finishing → ready → delivered (any step can be noted).
 * Production starts only from an approved design with exported files; «ready» prepares the customer message;
 * «delivered» marks the linked customer record as WON.
 */
export const STAGES = ['queued', 'printing', 'finishing', 'ready', 'delivered'] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_AR: Record<Stage, string> = { queued: 'بانتظار الطباعة', printing: 'قيد الطباعة', finishing: 'التشطيب والقص', ready: 'جاهز للاستلام', delivered: 'تم التسليم' };
type User = { sub: string; email: string; perms: readonly string[] };
export interface Production { stage: Stage; history: { stage: Stage; at: string; by: string; note?: string }[] }

export async function setStage(id: string, stage: Stage, user: User, note?: string) {
  const p = await loadPrint(id, user);
  if (!['approved', 'exported'].includes(p.status)) throw new AppError('NOT_APPROVED', 'التصميم غير معتمد — لا يبدأ الإنتاج قبل الاعتماد.', 409);
  if (!p.exports) throw new AppError('NO_FILES', 'جهّز ملفات الإنتاج أولًا (التصدير).', 409);
  const cur = (p.production as Production | null) ?? { stage: 'queued' as Stage, history: [] };
  const next: Production = { stage, history: [...cur.history, { stage, at: new Date().toISOString(), by: user.email, ...(note ? { note: note.slice(0, 300) } : {}) }].slice(-40) };
  await prisma.printProject.update({ where: { id }, data: { production: next as unknown as Prisma.InputJsonValue } });
  if (stage === 'delivered' && p.leadId) {
    const lead = await prisma.lead.findUnique({ where: { id: p.leadId } });
    if (lead && lead.status !== 'WON') await updateLead(p.leadId, { status: 'WON' }, user);
  }
  await audit({ actorId: user.sub, actorLabel: user.email, action: 'print.stage', targetType: 'print_project', targetId: id, details: { stage, note: note?.slice(0, 120) } });
  return next;
}

/** «your order is ready» — to the linked customer's WhatsApp (a person sends it) */
export async function readyMessage(id: string, user: User) {
  const p = await loadPrint(id, user);
  const lead = p.leadId ? await prisma.lead.findUnique({ where: { id: p.leadId } }) : null;
  const biz = await getBusiness();
  const text = [`مرحبًا${lead?.name ? ` ${lead.name.split(' ')[0]}` : ''} 👋`, `طلبك «${p.title}» جاهز للاستلام ✅`, contactLines(biz, 'ar').map((c) => `${c.label}: ${c.phone}`).join(' · '), 'شكرًا لثقتك بنا.'].join('\n');
  return { text, wa: waLink(lead?.contact, text) };
}
