import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge, Stat } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { CsvImport, InspiredIdeas } from '@/components/competitor-tools';
import { competitorReport, linkedBrands } from '@/lib/competitors/service';
import { fmtLocal } from '@/lib/time';
export const dynamic = 'force-dynamic';

const num = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? '—' : `${v.toLocaleString('en')}${unit}`);

export default async function CompetitorsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  await requirePageUser();
  const brands = await linkedBrands();
  const sp = await searchParams;
  const brandId = sp.brand && brands.some((b) => b.brandId === sp.brand) ? sp.brand : brands[0]?.brandId;
  const rep = brandId ? await competitorReport(brandId) : null;
  const a = rep?.analysis;
  const accounts = brands.find((b) => b.brandId === brandId)?.accounts ?? [];
  return (
    <>
      <PageHeader title="تحليل المنافسين" subtitle="مقارنة مع منافسيك المحليين على إنستغرام — من بيانات Metricool (المنافسون الذين تضيفهم أنت) أو ملف CSV مُصدَّر منه. لا نجمع بيانات من إنستغرام مباشرة." />
      {!brands.length ? <Card><p className="text-sm text-slate-600">اربط حساباتك بـ Metricool أولًا (إعدادات الربط).</p></Card> : (
        <>
          <form className="mb-4 flex flex-wrap items-center gap-2">
            <select name="brand" defaultValue={brandId} className="input" style={{ width: '18rem' }}>{brands.map((b) => <option key={b.brandId} value={b.brandId}>{b.accounts.map((x) => x.handle ?? x.name).join(' / ')} ({b.brandId})</option>)}</select>
            <button className="rounded-lg bg-navy-800 px-4 py-2 text-sm font-bold text-white">عرض</button>
            {brandId && <ActionButton url="/api/competitors/refresh" body={{ brandId }} label="تحديث من Metricool" variant="outline" size="sm" />}
          </form>
          {brandId && <Card className="mb-6"><CsvImport brandId={brandId} />
            <p className="mt-2 text-xs text-slate-500">في Metricool: Competitors ← أضف المنافسين ← Export CSV (جدول المنافسين و/أو منشوراتهم). يمكن رفع الملفين في نفس اليوم ويُدمجان.</p></Card>}
          {!a ? (
            <Card title="لا توجد بيانات منافسين بعد">
              <ol className="list-decimal space-y-1 pr-5 text-sm">
                <li>في Metricool افتح العلامة ← <b>Competitors</b> ← أضف 5–10 حسابات منافسة محلية على إنستغرام (مطابع، محلات هدايا مخصصة، طباعة ملصقات).</li>
                <li>ارجع هنا واضغط «تحديث من Metricool»، أو صدّر الجدول CSV واستورده أعلاه.</li>
                <li>يُحدَّث تلقائيًا كل يوم الساعة 06:20.</li>
              </ol>
            </Card>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-500">آخر بيانات: {fmtLocal(rep!.snapshot!.takenAt)} ({rep!.snapshot!.source === 'csv' ? 'ملف CSV' : 'Metricool'}){rep!.snapshot!.previousAt ? ` · مقارنة النمو مع ${fmtLocal(rep!.snapshot!.previousAt)}` : ' · النمو يظهر بعد لقطتين بفارق أسبوع'} · نافذة التحليل {a.windowDays} يومًا</p>
              <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="منافسون" value={a.competitors} /><Stat label="منشورات محللة" value={a.posts} />
                <Stat label="تفاعل الريلز ÷ المنشورات" value={a.formats.reelLift === null ? '—' : `${a.formats.reelLift}×`} hint={`${a.formats.reel.n} ريلز · ${a.formats.post.n} منشور`} tone="gold" />
                <Stat label="أفضل ساعة (تفاعل)" value={a.bestSlots[0] ? `${a.bestSlots[0].hour}:00` : '—'} hint={a.bestSlots[0] ? `${a.bestSlots[0].n} منشور${a.bestDays[0] ? ` · أفضل يوم: ${a.bestDays[0].day}` : ''}` : 'يحتاج 3 منشورات على الأقل لكل ساعة'} />
              </div>
              <Card title="توصيات تنافسية" className="mb-6">
                {a.opportunities.length ? <ul className="list-disc space-y-1 pr-5 text-sm">{a.opportunities.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="text-sm text-slate-500">لا توصيات حتى تتوفر بيانات كافية.</p>}
              </Card>
              <Card title="المقارنة المرجعية" className="mb-6 overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm"><thead><tr><th className="th">الحساب</th><th className="th">المتابعون</th><th className="th">النمو</th><th className="th">منشور/أسبوع</th><th className="th">نسبة الريلز</th><th className="th">متوسط التفاعل</th><th className="th">معدل التفاعل</th><th className="th">العينة</th></tr></thead>
                  <tbody>{a.bench.map((b) => (
                    <tr key={b.handle} className={`border-t ${b.isUs ? 'bg-gold-300/20 font-bold' : ''}`}>
                      <td className="td">{b.isUs ? <Badge tone="gold">نحن</Badge> : null} <span className="ltr">{/\s/.test(b.handle) ? b.handle : `@${b.handle}`}</span>{b.name && !b.isUs ? <div className="text-xs text-slate-500">{b.name}</div> : null}</td>
                      <td className="td">{num(b.followers)}</td>
                      <td className="td ltr">{b.followerGrowth === null ? '—' : `${b.followerGrowth >= 0 ? '+' : ''}${b.followerGrowth} (${b.followerGrowthPct}%)`}</td>
                      <td className="td">{num(b.postsPerWeek)}</td><td className="td">{num(b.reelShare, '%')}</td>
                      <td className="td">{num(b.avgInteractions)}</td><td className="td">{num(b.engagementRate, '%')}</td><td className="td text-xs">{b.sample}</td>
                    </tr>))}</tbody></table>
                <p className="mt-2 text-xs text-slate-500">معدل التفاعل = متوسط (إعجابات + تعليقات) للمنشور ÷ المتابعين. «—» = لا تتوفر بيانات (لا تقدير).</p>
              </Card>
              <div className="grid gap-6 xl:grid-cols-2">
                <Card title="أعلى منشورات المنافسين تفاعلًا">
                  <ol className="space-y-2 text-sm">{a.topPosts.map((p, i) => (
                    <li key={i} className="border-t pt-2"><div className="flex flex-wrap items-center gap-2"><b className="ltr">@{p.handle}</b><Badge tone={p.type === 'reel' ? 'navy' : 'slate'}>{p.type === 'reel' ? 'ريلز' : 'منشور'}</Badge><span className="text-xs text-slate-500">{p.day ?? ''} {p.hour !== null ? `${p.hour}:00` : ''} · {num(p.interactions)} تفاعل</span>{p.url && <a className="text-xs underline" href={p.url} target="_blank" rel="noreferrer">فتح</a>}</div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-600">{p.caption}</p></li>))}</ol>
                  {!a.topPosts.length && <p className="text-sm text-slate-500">لا توجد منشورات بتفاعل مسجل.</p>}
                </Card>
                <Card title="المواضيع والوسوم الرائجة">
                  <div className="mb-3 flex flex-wrap gap-1">{a.themes.map((t) => <Badge key={t.word} tone={a.gaps.includes(t.word) ? 'amber' : 'blue'}>{t.word} · {t.topShare}%</Badge>)}</div>
                  <p className="mb-3 text-xs text-slate-500">النسبة = حضور الكلمة في الربع الأعلى تفاعلًا. البرتقالي = موضوع ناجح لديهم وغير مستخدم لديك.</p>
                  <div className="flex flex-wrap gap-1">{a.hashtags.map((h) => <span key={h.tag} className="rounded bg-slate-100 px-2 py-0.5 text-xs ltr">{h.tag} ({h.count})</span>)}</div>
                  {a.bestSlots.length > 0 && <><div className="mt-4 text-xs font-bold text-slate-600">أفضل الأوقات (متوسط التفاعل)</div><ul className="text-xs">{a.bestSlots.map((s, i) => <li key={i}>{s.hour}:00 — {s.avgInteractions} ({s.n} منشور)</li>)}{a.bestDays.map((d, i) => <li key={`d${i}`}>يوم {d.day} — {d.avgInteractions} ({d.n} منشور)</li>)}</ul></>}
                </Card>
              </div>
              {accounts.length > 0 && <Card title="أفكار من تحليل السوق" className="mt-6"><InspiredIdeas brandId={brandId!} accounts={accounts.map((x) => ({ id: x.id, name: x.name }))} /></Card>}
            </>
          )}
        </>
      )}
    </>
  );
}
