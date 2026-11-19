import type { Metadata } from 'next';
import { publicProof } from '@/lib/print/proof';
import { ProofDecision } from '@/components/proof-decision';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'بروفة التصميم', robots: { index: false, follow: false } };

/** PUBLIC client proof page (secret link, no login): the exact design, watermarked, with its specs → approve / ask for changes */
export default async function ProofPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let p: Awaited<ReturnType<typeof publicProof>>;
  try { p = await publicProof(token); } catch { return <main dir="rtl" className="mx-auto max-w-xl p-6 text-center"><h1 className="text-xl font-extrabold">الرابط غير صالح</h1><p className="mt-2 text-slate-600">تأكد من الرابط أو اطلب رابطًا جديدًا من المطبعة.</p></main>; }
  const exp = p.expiresAt ? new Intl.DateTimeFormat('ar-BH-u-nu-latn', { timeZone: 'Asia/Bahrain', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(p.expiresAt)) : '';
  return (
    <main dir="rtl" className="mx-auto max-w-3xl space-y-4 bg-slate-50 p-3 sm:p-6">
      <header className="rounded-2xl bg-slate-900 p-4 text-white">
        <div className="text-xs opacity-80">{p.shop?.name ?? 'المطبعة'} · بروفة للمراجعة</div>
        <h1 className="mt-1 text-xl font-extrabold">{p.title}</h1>
        <div className="mt-1 text-xs opacity-90">{p.product}{p.trim ? <> · <span dir="ltr">{p.trim.w}×{p.trim.h} mm</span></> : null}{p.sides === 2 ? ' · وجهان' : ''}{p.material ? ` · ${p.material}` : ''}{p.finishes.length ? ` · ${p.finishes.join('، ')}` : ''}</div>
      </header>
      {p.stale && <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">تغيّر التصميم بعد إرسال هذه البروفة — اطلب الرابط الجديد من المطبعة.</p>}
      {p.expired && <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">انتهت صلاحية هذا الرابط — اطلب رابطًا جديدًا من المطبعة.</p>}
      {!p.expired && <section className="space-y-3">{Array.from({ length: p.images }, (_, i) => (
        <img key={i} src={`/api/proof/${token}/img/${i}`} alt={i === 0 ? 'معاينة واقعية' : `الصفحة ${i}`} className="w-full rounded-xl border bg-white" />
      ))}</section>}
      <section className="rounded-2xl border bg-white p-4 text-sm">
        <div className="font-extrabold">قبل الاعتماد راجع:</div>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-slate-700">
          <li>الأسماء والأرقام والعناوين والإملاء حرفًا حرفًا.</li>
          <li>الشعار ووضوحه.</li>
          <li>الألوان على الشاشة تختلف قليلًا عن الطباعة.</li>
          <li>العلامة «بروفة» لا تظهر في الطباعة النهائية.</li>
        </ul>
        {exp && !p.expired && <p className="mt-2 text-xs text-slate-500">الرابط صالح حتى {exp}.</p>}
      </section>
      <ProofDecision token={token} initial={p.decision} disabled={p.stale || p.expired} />
      {p.shop && <footer className="pb-6 text-center text-xs text-slate-500">{p.shop.name}{p.shop.phones.map((x) => <span key={x.phone}> · فرع {x.name}: <span dir="ltr">{x.phone}</span></span>)}</footer>}
    </main>
  );
}
