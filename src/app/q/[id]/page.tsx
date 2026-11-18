import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { getBusiness, contactLines } from '@/lib/business';
import { quoteTotals, scriptText, waLink, type Quote } from '@/lib/leads/scripts';
import { SalesAction } from '@/components/sales-action';
import { PrintButton } from '@/components/print-button';
export const dynamic = 'force-dynamic';

const d = (iso: string) => new Intl.DateTimeFormat('ar-BH-u-nu-latn', { timeZone: 'Asia/Bahrain', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
const m = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/** Printable branded quote (print → PDF) + send through WhatsApp. Outside the dashboard frame so it prints clean. */
export default async function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser('ads:approve');
  const { id } = await params;
  const [lead, s, business, logo] = await Promise.all([
    prisma.lead.findUniqueOrThrow({ where: { id } }), getSettings(), getBusiness(),
    prisma.brandAsset.findFirst({ where: { kind: 'LOGO_PRIMARY', active: true, approved: true } }),
  ]);
  const q = lead.quote as unknown as Quote | null;
  if (!q) return <main className="p-6 text-center"><p className="mb-3">لا يوجد عرض سعر لهذا العميل بعد.</p><Link className="font-bold text-gold-600 underline" href={`/leads/${id}/quote`}>إنشاء عرض سعر</Link></main>;
  const t = quoteTotals(q);
  const branches = contactLines(business, 'ar');
  const text = scriptText('quote_send', { ...lead, quote: q, touches: null }, { business: business.nameAr, branches, reactivationDays: s.sales.reactivationDays });
  return (
    <main className="mx-auto max-w-3xl bg-slate-100 p-3 print:bg-white print:p-0 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/leads" className="text-sm font-bold text-navy-800">→ العملاء والطلبات</Link>
        <div className="flex gap-2"><Link href={`/leads/${id}/quote`} className="rounded-lg border bg-white px-3 py-1.5 text-sm font-bold">✎ تعديل</Link><PrintButton /></div>
      </div>
      <article className="rounded-2xl bg-white p-5 shadow print:rounded-none print:shadow-none sm:p-8">
        <header className="flex items-start justify-between gap-4 border-b-4 border-[#e6c25a] pb-4">
          <div>
            <h1 className="text-2xl font-extrabold text-[#0b1730]">{business.nameAr}</h1>
            <div className="text-xs text-slate-500">{business.nameEn}</div>
            <div className="mt-2 space-y-0.5 text-sm">{branches.map((b) => <div key={b.key}>{b.label}: <span className="ltr font-bold">{b.phone}</span></div>)}</div>
          </div>
          {logo && <img src={`/api/media/${logo.storageKey}`} alt="الشعار" className="h-20 w-auto object-contain" />}
        </header>
        <section className="mt-4 flex flex-wrap justify-between gap-3 text-sm">
          <div><div className="text-lg font-extrabold text-[#0b1730]">عرض سعر رقم <span className="ltr">{q.no}</span></div><div className="text-slate-600">التاريخ: {d(q.at)}</div><div className="text-slate-600">صالح حتى: <b>{d(q.validUntil)}</b></div></div>
          <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">مقدم إلى</div><div className="font-bold">{lead.name ?? 'العميل الكريم'}</div>{lead.contact && lead.contact !== lead.name && <div className="ltr text-xs">{lead.contact}</div>}</div>
        </section>
        <table className="mt-4 w-full text-sm">
          <thead><tr className="bg-[#0b1730] text-white"><th className="p-2 text-right">البند</th><th className="p-2">الكمية</th><th className="p-2">سعر الوحدة</th><th className="p-2">المجموع</th></tr></thead>
          <tbody>{q.items.map((i, k) => <tr key={k} className="border-b"><td className="p-2">{i.desc}</td><td className="ltr p-2 text-center">{i.qty}</td><td className="ltr p-2 text-center">{m(i.unit)}</td><td className="ltr p-2 text-center font-bold">{m(i.qty * i.unit)}</td></tr>)}</tbody>
        </table>
        <div className="mt-3 mr-auto w-full max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><span>المجموع</span><span className="ltr">{m(t.subtotal)}</span></div>
          {t.discount > 0 && <div className="flex justify-between text-emerald-700"><span>خصم</span><span className="ltr">- {m(t.discount)}</span></div>}
          <div className="flex justify-between border-t-2 border-[#e6c25a] pt-1 text-lg font-extrabold text-[#0b1730]"><span>الإجمالي (د.ب)</span><span className="ltr">{m(t.total)}</span></div>
        </div>
        {q.notes && <p className="mt-4 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{q.notes}</p>}
        <p className="mt-4 text-xs leading-6 text-slate-500">{s.sales.quoteTerms}</p>
        <footer className="mt-6 rounded-xl bg-[#0b1730] p-3 text-center text-sm font-bold text-[#fff1b8]">اطلب الآن · {branches.map((b) => `${b.label} ${b.phone}`).join(' · ')}</footer>
      </article>
      <div className="mt-4 print:hidden"><SalesAction leadId={id} scriptKey="quote_send" label="إرسال عرض السعر للعميل" due text={text} wa={waLink(lead.contact, text)} /></div>
      <p className="mt-2 text-xs text-slate-500 print:hidden">للإرسال كملف: «طباعة / PDF» ← حفظ كـ PDF ← أرفقه في واتساب.</p>
    </main>
  );
}
