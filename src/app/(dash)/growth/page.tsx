import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { Badge, Card, PageHeader, Stat } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { GrowthStart } from '@/components/growth-start';
import { loadInsights } from '@/lib/analytics/account-insights';
import { buildPostingPlan, TIER_RULES, type PlanCurrent } from '@/lib/analytics/posting-plan';
import { baselineOf, dayOf, diagnose, loadProgram, PHASES, PROGRAM_DAYS, programProgress, targetsFor, weekOf, type Finding } from '@/lib/growth/program';
import { CONTENT_TYPES } from '@/lib/creative/options';
export const dynamic = 'force-dynamic';

const nf = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US'));
const FIND: Record<Finding['kind'], { icon: string; cls: string }> = { strength: { icon: '✅', cls: 'text-emerald-800' }, weakness: { icon: '⚠️', cls: 'text-red-800' }, opportunity: { icon: '🎯', cls: 'text-navy-800' } };
const ctAr = (v: string) => CONTENT_TYPES.find((c) => c.value === v)?.ar ?? v;

function Bar({ pct }: { pct: number | null }) {
  return <div className="h-2 rounded bg-slate-100"><div className={`h-2 rounded ${pct != null && pct >= 100 ? 'bg-emerald-500' : 'bg-gold-500'}`} style={{ width: `${Math.max(2, pct ?? 0)}%` }} /></div>;
}
function Findings({ list }: { list: Finding[] }) {
  if (!list.length) return <p className="text-xs text-slate-500">لا ملاحظات كافية من الأرقام الحالية.</p>;
  return <ul className="space-y-1 text-sm">{list.map((f, i) => <li key={i} className={FIND[f.kind].cls}>{FIND[f.kind].icon} {f.text}</li>)}</ul>;
}

export default async function GrowthPage() {
  const user = await requirePageUser();
  const canManage = user.perms.includes('accounts:manage');
  const [program, snap] = await Promise.all([loadProgram(), loadInsights()]);
  const header = <PageHeader title="برنامج النمو 30 يومًا" subtitle="تحليل كل حساب بأرقامه الحقيقية، أهداف واقعية، خطة أسبوعية يطبقها مصمم النظام تلقائيًا، ومتابعة التقدم مع تقرير أسبوعي." />;

  if (!snap) return (<>{header}<Card><p className="mb-3 text-sm text-slate-600">يحتاج البرنامج أرقام الحسابات من Metricool أولًا.</p><ActionButton url="/api/analytics/accounts" label="جلب البيانات الحقيقية الآن" variant="gold" success="تم ✓" /></Card></>);

  // ── running (or finished) program ──
  if (program) {
    const w = weekOf(program);
    const day = dayOf(program);
    const prog = await programProgress(program, snap);
    const tot = prog.reduce((a, g) => ({ made: a.made + g.made, published: a.published + g.published }), { made: 0, published: 0 });
    const target = program.accounts.reduce((a, x) => a + x.targets.contents, 0);
    const phase = w === 'done' ? null : PHASES[w - 1];
    return (
      <>
        {header}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="اليوم" value={w === 'done' ? 'انتهى' : <span className="ltr">{day} / {PROGRAM_DAYS}</span>} hint={`بدأ ${new Date(program.startedAt).toLocaleDateString('en-GB', { timeZone: 'Asia/Bahrain' })}`} tone="gold" />
          <Stat label="الحسابات" value={program.accounts.length} />
          <Stat label="منشور مؤكد / الهدف" value={<span className="ltr">{tot.published} / {target}</span>} tone="green" hint={`${tot.made} تصميم أُنتج`} />
          <Stat label="الأسبوع" value={w === 'done' ? '—' : <span className="ltr">{w} / 4</span>} hint={phase?.title} />
        </div>
        <div className="mb-5 grid gap-3 lg:grid-cols-4">
          {PHASES.map((ph) => (
            <div key={ph.week} className={`rounded-xl border p-3 ${w === ph.week ? 'border-2 border-gold-500 bg-gold-300/10' : w !== 'done' && ph.week < w ? 'opacity-60' : ''}`}>
              <div className="mb-1 flex items-center justify-between"><b className="text-navy-900">الأسبوع {ph.week}: {ph.title}</b>{w === ph.week && <Badge tone="gold">الآن</Badge>}</div>
              <p className="mb-2 text-xs leading-6 text-slate-600">{ph.goal}</p>
              <div className="mb-2 text-[11px] text-slate-500">زوايا المحتوى (يطبقها المصمم تلقائيًا): {ph.contentTypes.map(ctAr).join('، ')}</div>
              <ul className="space-y-1 text-xs text-slate-700">{ph.actions.map((a, i) => <li key={i}>☐ {a}</li>)}</ul>
              <div className="mt-2 text-[11px] font-bold text-navy-700">المؤشر: {ph.kpi}</div>
            </div>
          ))}
        </div>
        <Card title="التقدم لكل حساب">
          <div className="space-y-3">
            {program.accounts.map((a) => {
              const g = prog.find((x) => x.accountId === a.accountId)!;
              return (
                <details key={a.accountId} className="rounded-xl border p-3">
                  <summary className="cursor-pointer list-none">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><b className="text-navy-900">{a.name}</b><Badge tone={a.tier === 'grow' ? 'green' : a.tier === 'light' ? 'amber' : 'blue'}>{TIER_RULES[a.tier].ar}</Badge></div><span className="text-xs text-gold-600">التشخيص ▾</span></div>
                    <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                      <div><div className="mb-1">النشر: <b className="ltr">{g.published} / {a.targets.contents}</b> <span className="text-slate-500">({g.made} تصميم)</span></div><Bar pct={g.pctContent} /></div>
                      <div><div className="mb-1">المتابعون: <b className="ltr">{nf(a.baseline.followers)} → {nf(g.followersNow)}</b> <span className="text-slate-500">الهدف {nf(a.targets.followers)}</span></div><Bar pct={g.pctFollowers} /></div>
                      <div><div className="mb-1">الوصول/منشور: <b className="ltr">{a.baseline.reachPerContent} → {g.reachNow ?? '—'}</b> <span className="text-slate-500">الهدف {a.targets.reachPerContent ?? '—'}</span></div><Bar pct={g.pctReach} /></div>
                    </div>
                  </summary>
                  <div className="mt-3 border-t pt-3"><Findings list={a.findings} /></div>
                </details>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-slate-500">«الآن» من آخر تحديث للتحليلات (نافذة 30 يومًا، يتحدث مرتين يوميًا). الأهداف واقعية ومتحفظة — ليست ضمانًا. يصلك تنبيه في بداية كل أسبوع وتقرير ختامي في اليوم 30.</p>
        </Card>
        {canManage && <div className="mt-4 flex flex-wrap items-center gap-3">
          {w === 'done' ? <ActionButton url="/api/growth/program" method="DELETE" label="إغلاق البرنامج وبدء شهر جديد" variant="gold" />
            : <ActionButton url="/api/growth/program" method="DELETE" label="إيقاف البرنامج" variant="ghost" confirm="إيقاف برنامج النمو؟ يبقى إيقاع النشر الحالي كما هو، ويعود المصمم لاختيار زوايا المحتوى المعتاد." />}
          <Link href="/approvals" className="text-sm font-bold text-gold-600 underline">طابور الموافقات ←</Link>
        </div>}
      </>
    );
  }

  // ── not started: diagnosis + proposed targets + start ──
  const rows = await prisma.socialAccount.findMany({ select: { id: true, publishIntervalMinutes: true, maxDailyAds: true, formatStrategy: true, formatMix: true, publishWindowStart: true, publishWindowEnd: true, autoPublishEnabled: true } });
  const current: Record<string, PlanCurrent> = Object.fromEntries(rows.map(({ id, ...c }) => [id, c]));
  const plan = buildPostingPlan(snap, current);
  const items = plan.map((r) => { const ins = snap.accounts.find((a) => a.accountId === r.accountId)!; const b = baselineOf(ins); return { r, b, t: targetsFor(r.tier, b, r.postsPerDay * PROGRAM_DAYS), f: diagnose(ins, snap) }; });
  return (
    <>
      {header}
      <Card title="1) تشخيص الحسابات — من أرقامك الحقيقية" className="mb-4">
        <p className="mb-3 text-xs text-slate-500">آخر {snap.days} يومًا من Metricool · تحديث <span className="ltr">{new Date(snap.at).toLocaleString('en-GB', { timeZone: 'Asia/Bahrain', dateStyle: 'medium', timeStyle: 'short' })}</span></p>
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map(({ r, b, t, f }) => (
            <div key={r.accountId} className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between gap-2"><b className="truncate text-navy-900">{r.name}</b><Badge tone={r.tier === 'grow' ? 'green' : r.tier === 'light' ? 'amber' : 'blue'}>{TIER_RULES[r.tier].ar}</Badge></div>
              <div className="mb-2 grid grid-cols-4 gap-1 text-center text-[11px]">
                <div><div className="font-extrabold ltr">{nf(b.followers)}</div><div className="text-slate-500">متابع</div></div>
                <div><div className="font-extrabold">{b.content}</div><div className="text-slate-500">منشور</div></div>
                <div><div className="font-extrabold">{b.reachPerContent}</div><div className="text-slate-500">وصول/منشور</div></div>
                <div><div className="font-extrabold">{b.engagementRate == null ? '—' : `${b.engagementRate}%`}</div><div className="text-slate-500">تفاعل</div></div>
              </div>
              <Findings list={f} />
              <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs"><b>أهداف 30 يومًا:</b> {t.contents} منشور · متابعون {nf(t.followers)} · وصول/منشور {t.reachPerContent ?? 'يبدأ القياس'}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="2) الخطة الأسبوعية" className="mb-4">
        <div className="grid gap-3 lg:grid-cols-4">{PHASES.map((ph) => (
          <div key={ph.week} className="rounded-xl border p-3"><b className="text-navy-900">الأسبوع {ph.week}: {ph.title}</b><p className="mt-1 text-xs leading-6 text-slate-600">{ph.goal}</p><div className="mt-1 text-[11px] text-slate-500">زوايا المحتوى: {ph.contentTypes.map(ctAr).join('، ')}</div></div>
        ))}</div>
      </Card>
      <Card title="3) التنفيذ">
        {canManage ? <GrowthStart accounts={items.map(({ r }) => ({ id: r.accountId, name: r.name, tier: TIER_RULES[r.tier].ar, auto: r.current.autoPublishEnabled }))} canAutomate={user.perms.includes('automation:control')} />
          : <p className="text-sm text-slate-500">بدء البرنامج يحتاج صلاحية إدارة الحسابات.</p>}
      </Card>
    </>
  );
}
