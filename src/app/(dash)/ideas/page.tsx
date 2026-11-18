import Link from 'next/link';
import type { IdeaStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { Card, PageHeader, Badge } from '@/components/ui';
import { ActionButton } from '@/components/action-button';
import { IdeasSettings } from '@/components/ideas-settings';
import { IDEA_ANGLES } from '@/lib/creative/options';
import { ideaContext } from '@/lib/ideas/bank';
import { tasteProfile } from '@/lib/creative/taste';

export const dynamic = 'force-dynamic';
const STATUS_AR: Record<IdeaStatus, string> = { NEW: 'جديدة', APPROVED: 'معتمدة', USED: 'استُخدمت', REJECTED: 'مرفوضة' };
const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'ريلز', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_FEED: 'منشور', IMAGE_STORY: 'ستوري' };
const scoreTone = (n: number | null) => (n == null ? 'slate' : n >= 8 ? 'green' : n >= 6 ? 'blue' : 'amber');

export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ account?: string; status?: string }> }) {
  await requirePageUser('ads:create');
  const sp = await searchParams;
  const s = await getSettings();
  const accounts = await prisma.socialAccount.findMany({ select: { id: true, name: true, handle: true, businessCategory: true, language: true }, orderBy: { name: 'asc' } });
  const account = accounts.find((a) => a.id === sp.account) ?? accounts[0];
  const status = (['NEW', 'APPROVED', 'USED', 'REJECTED'] as const).find((x) => x === sp.status) ?? 'NEW';
  const counts = account ? await prisma.idea.groupBy({ by: ['status'], where: { accountId: account.id }, _count: true }) : [];
  const ideas = account ? await prisma.idea.findMany({ where: { accountId: account.id, status }, include: { product: { select: { titleAr: true } } }, orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 60 }) : [];
  const ctx = account ? await ideaContext(account) : null;
  const taste = await tasteProfile();
  const q = (o: { account?: string; status?: string }) => `/ideas?account=${o.account ?? account?.id ?? ''}&status=${o.status ?? status}`;
  return (
    <>
      <PageHeader title="💡 بنك الأفكار" subtitle="أفكار مقيّمة لكل حساب من 12 زاوية إعلانية مجربة، مبنية على ما نجح فعلًا في حسابك والمناسبات القادمة. الأفكار المعتمدة يستخدمها النشر الآلي تلقائيًا — كل فكرة مرة واحدة." />
      <Card title="الإعدادات" className="mb-6"><IdeasSettings initial={s.ideas} /></Card>
      <Card collapsible title={`🎯 ذوقك كما تعلّمه النظام (${taste.decisions} قرار خلال 90 يومًا)`} className="mb-6">
        {taste.decisions === 0 ? <p className="text-sm text-slate-500">لم تتخذ قرارات موافقة أو رفض بعد. كل «اعتماد» و«رفض» (مع السبب) يعلّم النظام ذوقك.</p> : (
          <div className="space-y-3 text-sm">
            {taste.feedback.length > 0 && <div><div className="mb-1 font-bold text-navy-800">ملاحظاتك التي يتبعها المصمم:</div><ul className="list-inside list-disc text-slate-700">{taste.feedback.map((f) => <li key={f}>{f}</li>)}</ul></div>}
            {(['concept', 'designStyle'] as const).map((k) => taste.stats[k].length > 0 && (
              <div key={k}><div className="mb-1 font-bold text-navy-800">{k === 'concept' ? 'الأفكار البصرية' : 'أساليب التصميم'}:</div>
                <div className="flex flex-wrap gap-1">{taste.stats[k].map((x) => (
                  <Badge key={x.value} tone={taste.blocked[k].includes(x.value) ? 'red' : taste.liked[k].includes(x.value) ? 'green' : 'slate'}>
                    {taste.blocked[k].includes(x.value) ? '✗ ' : taste.liked[k].includes(x.value) ? '♥ ' : ''}{x.label} · {x.approved}✓ {x.rejected}✗
                  </Badge>))}</div></div>))}
            <p className="text-xs text-slate-500">♥ تحبه (≥75% موافقة) · ✗ خرج من التناوب (رُفض مرارًا: ≤35% موافقة من 3 قرارات فأكثر) · الأفكار والعناوين المرفوضة لا تُقترح مرة أخرى. لتغيير التوجيه الدائم: إعدادات الذكاء الاصطناعي ← استوديو الإبداع.</p>
          </div>
        )}
      </Card>
      {account && (
        <>
          <div className="mb-4 flex flex-wrap gap-1">
            {accounts.map((a) => <Link key={a.id} href={q({ account: a.id })} className={`rounded-full border px-3 py-1 text-sm ${a.id === account.id ? 'border-navy-800 bg-navy-800 text-white' : 'bg-white'}`}>{a.name}</Link>)}
          </div>
          <Card title={`${account.name} — الأفكار`} actions={<ActionButton url="/api/ideas/generate" body={{ accountId: account.id }} label="✨ ولّد أفكارًا الآن" size="sm" />}>
            {ctx && (ctx.winners.length > 0 || ctx.upcoming.length > 0) && (
              <div className="mb-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                {ctx.winners.length > 0 && <div>📈 ما نجح في هذا الحساب (يُستخدم في الأفكار): {ctx.winners.join(' · ')}</div>}
                {ctx.upcoming.length > 0 && <div>📅 مناسبات قادمة: {ctx.upcoming.join(' · ')}</div>}
              </div>
            )}
            <div className="mb-3 flex flex-wrap gap-1 text-sm">
              {(['NEW', 'APPROVED', 'USED', 'REJECTED'] as const).map((st) => <Link key={st} href={q({ status: st })} className={`rounded-lg border px-3 py-1 ${st === status ? 'border-gold-500 bg-gold-300/30 font-bold' : ''}`}>{STATUS_AR[st]} ({counts.find((c) => c.status === st)?._count ?? 0})</Link>)}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {ideas.map((i) => (
                <div key={i.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={scoreTone(i.score)}>{i.score != null ? `${i.score}/10` : '—'}</Badge>
                    {i.angle && <Badge tone="gold">{IDEA_ANGLES.find((a) => a.value === i.angle)?.ar ?? i.angle}</Badge>}
                    {i.format && <Badge tone="navy">{FORMAT_AR[i.format] ?? i.format}</Badge>}
                    <span className="text-xs text-slate-500">{i.product.titleAr}</span>
                  </div>
                  <div className="mt-2 font-extrabold text-navy-800">{i.title}</div>
                  {i.hook && <div className="mt-1 text-sm">🎣 <b>الافتتاحية:</b> {i.hook}</div>}
                  <p className="mt-1 text-sm text-slate-700">{i.idea}</p>
                  {i.why && <p className="mt-1 text-xs text-slate-500">لماذا: {i.why}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(i.status === 'NEW' || i.status === 'APPROVED') && <ActionButton url={`/api/ideas/${i.id}/use`} label="🎨 صمّم الآن" size="sm" />}
                    {i.status !== 'APPROVED' && i.status !== 'USED' && <ActionButton url={`/api/ideas/${i.id}`} method="PATCH" body={{ status: 'APPROVED' }} label="✓ اعتماد للنشر الآلي" size="sm" variant="success" />}
                    {i.status !== 'REJECTED' && i.status !== 'USED' && <ActionButton url={`/api/ideas/${i.id}`} method="PATCH" body={{ status: 'REJECTED' }} label="رفض" size="sm" variant="outline" />}
                  </div>
                </div>
              ))}
            </div>
            {!ideas.length && <p className="text-sm text-slate-500">لا توجد أفكار هنا — اضغط «✨ ولّد أفكارًا الآن».</p>}
          </Card>
        </>
      )}
    </>
  );
}
