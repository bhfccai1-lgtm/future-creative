import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge } from '@/components/ui';
import { StateBadge, FORMAT_AR, LANG_AR } from '@/components/state-badge';
import { ActionButton } from '@/components/action-button';
import { DeleteAdButton } from '@/components/delete-ad-button';
import { algoInputFromAd, algorithmScore } from '@/lib/growth/algorithm';
import { peakHoursFor } from '@/lib/growth/peak-hours';
import { fmtLocal } from '@/lib/time';
import { qcVerdict, QC_VERDICT_AR, type QcReport } from '@/lib/qc';
import Link from 'next/link';
import { directionSummaryAr, type Direction } from '@/lib/creative/options';

export default async function AdPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const ad = await prisma.advertisement.findUnique({ where: { id }, include: { media: true, product: true, account: { include: { connection: true } }, brief: true, jobs: { include: { attempts: true, result: true } }, approvals: true } });
  if (!ad) notFound();
  const finalImg = ad.media.find((m) => m.role === 'FINAL');
  const video = ad.media.find((m) => m.role === 'VIDEO');
  const qc = ad.qcReport as unknown as QcReport | null;
  const canDecide = ad.state === 'QUALITY_REVIEW';
  const verdict = qcVerdict(qc);
  const opts = (ad.options ?? {}) as { revisionOf?: string | null };
  const [parent, children] = await Promise.all([
    opts.revisionOf ? prisma.advertisement.findUnique({ where: { id: opts.revisionOf }, select: { id: true, headline: true, state: true, createdAt: true } }) : null,
    prisma.advertisement.findMany({ where: { options: { path: ['revisionOf'], equals: id } }, select: { id: true, headline: true, state: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  return (
    <>
      <PageHeader title={ad.headline ?? ad.product.titleAr} subtitle={`${ad.account.name} · ${ad.product.titleAr} · ${FORMAT_AR[ad.format]} · ${LANG_AR[ad.language]}`}
        actions={<>
          <StateBadge state={ad.state} />
          {ad.dryRun && <Badge tone="amber">معاينة تجريبية — غير قابلة للنشر</Badge>}
          <Badge tone={verdict === 'PASS' ? 'green' : verdict === 'NEEDS_REVIEW' ? 'blue' : verdict === 'NEEDS_ASSET' ? 'amber' : 'red'}>QC: {QC_VERDICT_AR[verdict]}</Badge>
          {['QUALITY_REVIEW', 'APPROVED', 'FAILED'].includes(ad.state) && <ActionButton url={`/api/ads/${id}/request-changes`} label="✎ تعديل" variant="outline" prompt="ما التعديل المطلوب؟ (سيُنشأ تصميم جديد بنفس الإعدادات مع ملاحظتك)" promptKey="note" />}
          {canDecide && ad.qcPassed && <ActionButton url={`/api/ads/${id}/approve`} label="اعتماد" variant="success" />}
          {['QUALITY_REVIEW', 'APPROVED'].includes(ad.state) && qc?.publishable && <ActionButton url={`/api/ads/${id}/publish-now`} label="نشر الآن" variant="gold" confirm="سيتم إرسال الإعلان إلى المزود لأقرب موعد آمن. متابعة؟" />}
          {ad.state === 'FAILED' && !ad.dryRun && ad.media.some((m) => m.role === 'FINAL') && (ad.format !== 'REEL_VIDEO' || ad.media.some((m) => m.role === 'VIDEO')) && <ActionButton url={`/api/ads/${id}/publish-now`} body={{ overrideQc: !qc?.publishable }} label="🚀 نشر الآن" variant="gold" success="أُرسل للنشر — سيُنشر في أقرب وقت آمن"
            confirm={`هذا التصميم متوقف بحالة «فشل»${ad.errorMessage ? ` (${ad.errorMessage.slice(0, 80)})` : ''}، لكن ملفاته النهائية موجودة.\n\nشاهد الفيديو/الصورة أولًا وتأكد من النص والأرقام والشعار.\nنشره الآن في أقرب وقت آمن؟${qc?.publishable ? '' : '\n\nتنبيه: لم يجتز فحص الجودة — يُسجَّل القرار باسمك.'}`} />}
          {['QUALITY_REVIEW', 'APPROVED'].includes(ad.state) && !qc?.publishable && !ad.dryRun && <ActionButton url={`/api/ads/${id}/publish-now`} body={{ overrideQc: true }} label="⚠ نشر الآن (تجاوز الجودة)" variant="gold" success="أُرسل للنشر رغم ملاحظات الجودة — سُجّل باسمك"
            confirm={`نشر هذا التصميم بدون اجتياز فحص الجودة؟\n\nالملاحظات:\n${(qc?.checks ?? []).filter((c) => !c.passed).map((c) => `• ${c.label}`).join('\n') || '• يحتاج مراجعة بشرية'}\n\nتأكد بنفسك من النص والأرقام والشعار. يُسجَّل القرار باسمك.`}
            prompt="سبب النشر رغم الملاحظات (اختياري)" promptKey="reason" />}
          {ad.media.some((m) => m.role === 'FINAL') && <a href={`/api/ads/${id}/export`} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 hover:bg-slate-50" download>تنزيل PNG</a>}
          {!['PUBLISHED', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'UNKNOWN', 'GENERATING'].includes(ad.state) && <DeleteAdButton adId={id} headline={ad.headline} after="/library" />}
          {['QUALITY_REVIEW', 'APPROVED', 'QUEUED'].includes(ad.state) && <ActionButton url={`/api/ads/${id}/reject`} label="رفض" variant="danger" prompt="سبب الرفض (اختياري)" promptKey="note" />}
        </>} />
      {ad.errorMessage && <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">{ad.errorMessage}
        {ad.state === 'FAILED' && <div className="mt-2"><ActionButton url={`/api/ads/${id}/regenerate`} label="إعادة التوليد بنفس الإعدادات" variant="gold" size="sm" /> <span className="text-xs text-slate-600">يظهر التصميم الجديد في طابور الموافقات خلال دقيقة تقريبًا.</span></div>}
      </div>}
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          {video ? <video className="w-full rounded-xl shadow" src={`/api/media/${video.storageKey}`} controls playsInline /> : finalImg ? <img className="w-full rounded-xl shadow" src={`/api/media/${finalImg.storageKey}`} alt="التصميم النهائي" /> : <div className="card p-8 text-center text-slate-500">لا توجد وسائط</div>}
          {video && finalImg && <img className="w-1/2 rounded-lg" src={`/api/media/${finalImg.storageKey}`} alt="صورة ثابتة" />}
          {ad.format === 'IMAGE_CAROUSEL' && (
            <div>
              <div className="mb-1 text-xs font-bold text-slate-600">شرائح الكاروسيل (بالترتيب — تُنشر كمنشور واحد)</div>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {[...ad.media.filter((m) => m.role === 'FINAL'), ...ad.media.filter((m) => m.role === 'SLIDE').sort((a, b) => Number((a.meta as { index?: number })?.index ?? 0) - Number((b.meta as { index?: number })?.index ?? 0))].map((m, i) => (
                  <a key={m.id} href={`/api/media/${m.storageKey}`} target="_blank" rel="noreferrer" className="shrink-0"><img className="h-40 rounded-lg border shadow-sm" src={`/api/media/${m.storageKey}`} alt={`شريحة ${i + 1}`} /><div className="text-center text-[10px] text-slate-500">{i + 1}</div></a>
                ))}
              </div>
            </div>
          )}
          {video && <p className="text-xs text-slate-500 ltr">MP4 · {video.width}×{video.height} · {video.durationSec?.toFixed(1)}s · {(video.bytes / 1e6).toFixed(1)}MB</p>}
        </div>
        <div className="space-y-6">
          <AlgorithmCard algo={algorithmScore(algoInputFromAd(ad, (await peakHoursFor(ad.account).catch(() => null))?.hours))} gate={((ad.options ?? {}) as { algorithm?: { before: number; after: number; fixes: string[] } }).algorithm ?? null} />
          <Card title={`فحص الجودة ${qc ? (qc.passed ? '— ناجح' : '— فشل') : ''}`}>
            {qc ? (
              <ul className="space-y-1 text-sm">
                {qc.checks.map((c) => (
                  <li key={c.id} className="flex gap-2"><span>{c.passed ? '✅' : c.severity === 'BLOCKER' ? '⛔' : '⚠️'}</span><span className="font-semibold">{c.label}</span>{c.detail && <span className="text-xs text-slate-500">— {c.detail}</span>}</li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">لم يتم الفحص بعد.</p>}
          </Card>
          {(() => {
            // «مصادر الإلهام»: the Freepik references that were analysed for this design (principles only — never copied)
            const ins = ((ad.options ?? {}) as { inspiration?: { query: string; at: string; principles: { composition?: string; colors?: string; lighting?: string; productPresentation?: string; takeaways?: string[]; avoid?: string[] }; sources: { id: string; title: string; url: string; author: string; license: string }[] } }).inspiration;
            if (!ins?.sources?.length) return null;
            const LIC: Record<string, string> = { freemium: 'مجاني بنسبة', premium: 'ترخيص مدفوع', unknown: 'غير محدد' };
            return (
              <Card title={`🔎 مصادر الإلهام (${ins.sources.length}) — Freepik`} collapsible>
                <p className="mb-2 text-xs text-slate-500">حُلّلت للمبادئ فقط — لم تُنسخ ولم تُرسل لمولّد الصور. البحث: «{ins.query}»</p>
                <ul className="mb-3 space-y-1 text-sm">{ins.sources.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-2"><a className="font-bold text-navy-800 underline" href={r.url} target="_blank" rel="noreferrer noopener" dir="ltr">{r.title || r.id}</a>
                    <span className="text-xs text-slate-500">{r.author}</span><span className="rounded-full bg-slate-100 px-2 text-[11px]">{LIC[r.license] ?? r.license}</span></li>))}</ul>
                <dl className="grid gap-2 text-xs md:grid-cols-2" dir="ltr">
                  {(['composition', 'colors', 'lighting', 'productPresentation'] as const).map((k) => ins.principles[k] ? <div key={k}><dt className="font-bold text-slate-500">{k}</dt><dd>{ins.principles[k]}</dd></div> : null)}
                  {ins.principles.takeaways?.length ? <div className="md:col-span-2"><dt className="font-bold text-slate-500">takeaways</dt><dd>{ins.principles.takeaways.join(' · ')}</dd></div> : null}
                </dl>
              </Card>
            );
          })()}
          {ad.brief && (
            <Card title="الموجز الإبداعي">
              <dl className="grid gap-2 text-sm md:grid-cols-2">
                <div><dt className="text-slate-500">الفكرة</dt><dd>{ad.brief.idea}</dd></div>
                <div><dt className="text-slate-500">الجمهور / المناسبة</dt><dd>{ad.brief.audience} / {ad.brief.occasion}</dd></div>
                <div className="md:col-span-2"><dt className="text-slate-500">وصف المشهد (للنموذج)</dt><dd className="ltr text-xs">{ad.brief.sceneDescription}</dd></div>
                {(((ad.brief.rawJson as { storyboard?: { beat: string; scene: string }[] } | null)?.storyboard) ?? []).length > 0 && (
                  <div className="md:col-span-2"><dt className="text-slate-500">🎬 القصة المصورة للريلز</dt>
                    <dd><ol className="mt-1 space-y-1">{((ad.brief.rawJson as { storyboard: { beat: string; scene: string }[] }).storyboard).map((x, i) => (
                      <li key={i} className="flex gap-2 text-xs"><span className="shrink-0 rounded bg-navy-800 px-2 py-0.5 font-bold text-white">{i + 1}. {({ hook: 'الافتتاحية', context: 'الموقف', product: 'المنتج', benefit: 'الفائدة' } as Record<string, string>)[x.beat] ?? x.beat}</span><span className="ltr">{x.scene}</span></li>))}</ol></dd></div>
                )}
                <div className="md:col-span-2"><dt className="text-slate-500">النص المرافق</dt><dd className="whitespace-pre-wrap">{ad.caption}</dd></div>
                {directionSummaryAr((ad.brief.rawJson as { direction?: Direction } | null)?.direction).map(([k, val]) => (
                  <div key={k}><dt className="text-slate-500">{k}</dt><dd>{val}</dd></div>
                ))}
                <div><dt className="text-slate-500">المزوّد</dt><dd>{ad.brief.provider}</dd></div>
                <div><dt className="text-slate-500">بصمة الشعار</dt><dd className="ltr text-xs">{ad.logoSha256?.slice(0, 24)}…</dd></div>
              </dl>
            </Card>
          )}
          {(parent || children.length > 0) && (
            <Card title="سجل النسخ والتعديلات">
              <ul className="space-y-1 text-sm">
                {parent && <li>⬅ النسخة السابقة: <Link className="text-navy-700 underline" href={`/ads/${parent.id}`}>{parent.headline ?? parent.id}</Link> <StateBadge state={parent.state} /> <span className="text-xs text-slate-500">{fmtLocal(parent.createdAt)}</span></li>}
                <li className="font-bold">● هذه النسخة <StateBadge state={ad.state} /></li>
                {children.map((c) => <li key={c.id}>➡ نسخة معدّلة: <Link className="text-navy-700 underline" href={`/ads/${c.id}`}>{c.headline ?? c.id}</Link> <StateBadge state={c.state} /> <span className="text-xs text-slate-500">{fmtLocal(c.createdAt)}</span></li>)}
              </ul>
            </Card>
          )}
          <Card title="محاولات النشر">
            {ad.jobs.length ? ad.jobs.map((j) => (
              <div key={j.id} className="mb-3 rounded border p-3 text-sm">
                <div className="flex flex-wrap gap-2"><StateBadge state={j.state} /><span>موعد: {fmtLocal(j.scheduledFor)}</span><span className="ltr text-xs text-slate-500">{j.idempotencyKey}</span></div>
                {j.result && <div className="mt-1 text-xs">معرّف المزود: <span className="ltr">{j.result.providerPostId}</span> · الحالة: {j.result.providerStatus} {j.result.verifiedAt && `· مؤكد ${fmtLocal(j.result.verifiedAt)}`} {j.result.publicUrl && <a className="underline" href={j.result.publicUrl}>الرابط</a>}</div>}
                {j.attempts.map((at) => <div key={at.id} className="text-xs text-slate-600">#{at.attemptNo} {at.outcome ?? '…'} {at.httpStatus ?? ''} {at.error ?? ''}</div>)}
                {j.lastError && <div className="text-xs text-red-700">{j.lastError}</div>}
              </div>
            )) : <p className="text-sm text-slate-500">لم يُرسل للنشر.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}

const GRADE: Record<string, string> = { A: 'bg-emerald-600', B: 'bg-sky-600', C: 'bg-amber-500', D: 'bg-red-600' };
function AlgorithmCard({ algo, gate }: { algo: ReturnType<typeof algorithmScore>; gate: { before: number; after: number; fixes: string[] } | null }) {
  const todo = algo.signals.filter((x) => !x.ok);
  return (
    <Card title="📈 مؤشر الخوارزمية — جاهزية التصميم للوصول" collapsible>
      <div className="mb-3 flex items-center gap-3">
        <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-2xl font-extrabold text-white ${GRADE[algo.grade]}`}>{algo.score}</div>
        <p className="text-sm leading-6 text-slate-600">مبني على إشارات أعلنتها إنستغرام: مدة المشاهدة وأول ثانيتين، الإرسال لصديق والحفظ، الأصالة، البحث بالكلمات، والوقت. {todo.length ? `${todo.length} تحسين ممكن:` : 'جاهز ✓'}</p>
      </div>
      {gate && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-900">
          <b>⚙️ صُمّم حسب المؤشر تلقائيًا:</b> {gate.before} ← {gate.after}
          {gate.fixes.length ? <ul className="mt-1 list-inside list-disc text-xs">{gate.fixes.map((f) => <li key={f}>{f}</li>)}</ul> : <span className="text-xs"> — النص كان مطابقًا بلا تعديل</span>}
        </div>
      )}
      <ul className="space-y-1.5 text-sm">{algo.signals.map((x) => (
        <li key={x.id} className={x.ok ? 'text-slate-700' : 'text-amber-800'}>
          {x.ok ? '✅' : '⚠️'} {x.label} <span className="text-xs text-slate-400">({x.points}/{x.max})</span>
          {x.tip && <div className="mr-6 text-xs text-slate-600">💡 {x.tip}</div>}
        </li>
      ))}</ul>
      <p className="mt-3 text-[11px] text-slate-500">مؤشر جاهزية وليس توقعًا للوصول. لا يُستخدم أي تفاعل وهمي أو حيل — إنستغرام يعاقب عليها.</p>
    </Card>
  );
}
