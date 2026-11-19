import { prisma } from '../db';
import { AppError } from '../errors';
import { getBusiness, contactLines } from '../business';
import { getSettings } from '../settings';
import { createLead, saveQuote } from '../leads/service';
import { quoteTotals, waLink, type Quote } from '../leads/scripts';
import { BriefSchema, type Analysis } from './brief';
import { FINISHES, MATERIALS } from './catalog';
import { loadPrint } from './service';

/**
 * QUOTE FROM THE DESIGN: the item description is written from the real specs (product, size, sides/pages, material,
 * finishes); the quantity and the PRICES are always typed by the shop — the system never prices. The quote lives on
 * the customer record (العملاء والطلبات), and one WhatsApp message carries the quote and the proof link.
 */
type User = { sub: string; email: string; perms: readonly string[] };

export function specLine(a: Analysis, b: ReturnType<typeof BriefSchema.parse>) {
  const parts = [a.product.ar, `${a.trim.w}×${a.trim.h} مم`];
  if (a.product.family === 'multipage') parts.push(`${a.pages} صفحة`); else if (a.sides === 2) parts.push('وجهان');
  if (a.material) parts.push(MATERIALS[a.material]?.ar ?? a.material);
  const fin = b.finishes.filter((f) => a.product.finishes.includes(f)).map((f) => FINISHES[f]?.ar ?? f);
  if (fin.length) parts.push(fin.join(' + '));
  return parts.join(' · ').slice(0, 120);
}

export async function quoteDraft(id: string, user: User) {
  const p = await loadPrint(id, user);
  const a = p.analysis as unknown as Analysis, b = BriefSchema.parse(p.brief);
  const lead = p.leadId ? await prisma.lead.findUnique({ where: { id: p.leadId } }) : null;
  return { desc: specLine(a, b), quantity: b.quantity ?? null, lead: lead ? { id: lead.id, name: lead.name, contact: lead.contact, quote: lead.quote as unknown as Quote | null } : null };
}

export interface PrintQuoteInput {
  leadId?: string; newLead?: { name: string; contact?: string };
  quantity: number; unitPrice: number; designFee?: number; discount?: number; notes?: string;
}
export async function quoteFromPrint(id: string, input: PrintQuoteInput, user: User) {
  const p = await loadPrint(id, user);
  const a = p.analysis as unknown as Analysis, b = BriefSchema.parse(p.brief);
  if (!(input.quantity >= 1)) throw new AppError('QTY', 'اكتب الكمية.', 422);
  if (!(input.unitPrice >= 0)) throw new AppError('PRICE', 'اكتب سعر الوحدة.', 422);
  // the customer: an existing record, or a new one created from this design
  let leadId = input.leadId ?? p.leadId ?? null;
  if (leadId && !(await prisma.lead.findUnique({ where: { id: leadId } }))) throw new AppError('NO_LEAD', 'العميل غير موجود.', 404);
  if (!leadId) {
    if (!input.newLead?.name?.trim()) throw new AppError('NAME', 'اختر عميلًا أو اكتب اسم عميل جديد.', 422);
    const lead = await createLead({ name: input.newLead.name.trim().slice(0, 80), contact: input.newLead.contact?.trim().slice(0, 60) || null, need: specLine(a, b), source: 'other', notes: `من استوديو الطباعة: ${p.title}` }, user);
    leadId = lead.id;
  }
  // unit price per piece is typed by the shop; large runs are usually priced per lot — both are just numbers here
  const items = [{ desc: specLine(a, b), qty: Math.round(input.quantity), unit: input.unitPrice }];
  if (input.designFee && input.designFee > 0) items.push({ desc: `تصميم «${p.title}»`.slice(0, 120), qty: 1, unit: input.designFee });
  const lead = await saveQuote(leadId, { items, discount: input.discount ?? 0, notes: input.notes ?? '' }, user);
  await prisma.printProject.update({ where: { id }, data: { leadId, brief: { ...b, quantity: Math.round(input.quantity) } as never } });
  return { leadId, quote: lead.quote as unknown as Quote, message: await quoteMessage(id, user) };
}

/** one WhatsApp message: the quote summary + the proof link (when valid) + branches */
export async function quoteMessage(id: string, user: User, origin = '') {
  const p = await loadPrint(id, user);
  const lead = p.leadId ? await prisma.lead.findUnique({ where: { id: p.leadId } }) : null;
  const q = lead?.quote as unknown as Quote | null;
  if (!lead || !q) return null;
  const [biz, s] = await Promise.all([getBusiness(), getSettings()]);
  const t = quoteTotals(q);
  const money = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} د.ب`;
  const valid = new Intl.DateTimeFormat('ar-BH-u-nu-latn', { timeZone: 'Asia/Bahrain', day: 'numeric', month: 'long' }).format(new Date(q.validUntil));
  const proof = p.proofToken && p.proofExpiresAt && p.proofExpiresAt > new Date() ? `${origin}/proof/${p.proofToken}` : null;
  const lines = [
    `مرحبًا${lead.name ? ` ${lead.name.split(' ')[0]}` : ''} 👋`,
    `عرض السعر رقم ${q.no} — ${p.title}`,
    ...q.items.map((i) => `• ${i.desc} × ${i.qty} = ${money(i.qty * i.unit)}`),
    ...(t.discount ? [`الخصم: ${money(t.discount)}`] : []),
    `الإجمالي: ${money(t.total)}`,
    `العرض صالح حتى ${valid}.`,
    ...(proof ? ['', `بروفة التصميم للمراجعة والاعتماد:`, proof] : []),
    '', s.sales.quoteTerms,
    contactLines(biz, 'ar').map((c) => `${c.label}: ${c.phone}`).join(' · '),
  ];
  const text = lines.join('\n');
  return { text, wa: waLink(lead.contact, text), hasProof: !!proof };
}
