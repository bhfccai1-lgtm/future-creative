import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageUser } from '@/lib/auth/server';
import { secretStatus } from '@/lib/settings';
import { Card, PageHeader, Stat } from '@/components/ui';
import { CommentCard, ImportBox, SyncButton, TokenCard, type CommentRow } from '@/components/comments-ui';
import { commentStats } from '@/lib/comments/service';
import { can } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';
const TABS = [['urgent', 'عاجل'], ['new', 'بانتظار الرد'], ['replied', 'تم الرد'], ['closed', 'مغلق'], ['all', 'الكل']] as const;
const CATS = [['order', 'طلبات'], ['price', 'أسعار'], ['complaint', 'شكاوى'], ['info', 'استفسارات'], ['praise', 'مدح'], ['spam', 'سبام']] as const;

export default async function CommentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; cat?: string; account?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? 'urgent';
  const where = {
    ...(tab === 'urgent' ? { status: 'NEW', urgent: true } : tab === 'new' ? { status: 'NEW' } : tab === 'replied' ? { status: 'REPLIED' } : tab === 'closed' ? { status: 'IGNORED' } : {}),
    ...(sp.cat ? { category: sp.cat } : {}), ...(sp.account ? { accountId: sp.account } : {}),
  };
  const [rows, stats, token, accounts] = await Promise.all([
    prisma.socialComment.findMany({ where, include: { account: { select: { name: true } } }, orderBy: [{ urgent: 'desc' }, { postedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 100 }),
    commentStats(), secretStatus('META_COMMENTS_TOKEN'),
    prisma.socialAccount.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const canSend = can(user.perms, 'publish:now');
  const q = (o: Record<string, string | undefined>) => '/comments?' + new URLSearchParams(Object.entries({ tab, cat: sp.cat, account: sp.account, ...o }).filter(([, v]) => v) as [string, string][]).toString();
  const list: CommentRow[] = rows.map((r) => ({ id: r.id, account: r.account.name, username: r.username, text: r.text, postedAt: r.postedAt?.toISOString() ?? null, source: r.source, category: r.category, sentiment: r.sentiment, urgent: r.urgent, summary: r.summary, suggestedReply: r.suggestedReply, status: r.status, repliedText: r.repliedText, permalink: r.permalink }));
  return (
    <>
      <PageHeader title="التعليقات والردود" subtitle="كل تعليقات حساباتك في مكان واحد: تصنيف ذكي، العاجل أولًا، ورد مقترح آمن باللهجة البحرينية — ترسله أنت بضغطة." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="عاجل ينتظر الرد" value={stats.urgent} tone="red" hint="طلبات · أسعار · شكاوى" />
        <Stat label="بانتظار الرد" value={stats.open} tone="gold" />
        <Stat label="طلبات وأسعار (30 يومًا)" value={(stats.byCat.order ?? 0) + (stats.byCat.price ?? 0)} tone="green" hint="فرص بيع مباشرة" />
        <Stat label="متوسط زمن الرد" value={stats.medianReplyMin == null ? '—' : stats.medianReplyMin < 60 ? `${stats.medianReplyMin} د` : `${Math.round(stats.medianReplyMin / 60)} س`} hint="الهدف: أقل من ساعة" />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-sm" aria-label="حالة التعليقات">
          {TABS.map(([k, ar]) => <Link key={k} href={q({ tab: k })} className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-bold ${tab === k ? 'bg-navy-800 text-white' : 'text-slate-600'}`}>{ar}</Link>)}
        </nav>
        {token.configured && <SyncButton />}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5 text-xs">
        <Link href={q({ cat: undefined })} className={`rounded-full border px-3 py-1 ${!sp.cat ? 'border-navy-800 bg-navy-800 text-white' : 'bg-white'}`}>كل الأنواع</Link>
        {CATS.map(([k, ar]) => <Link key={k} href={q({ cat: k })} className={`rounded-full border px-3 py-1 ${sp.cat === k ? 'border-navy-800 bg-navy-800 text-white' : 'bg-white'}`}>{ar}{stats.byCat[k] ? <b className="mr-1">{stats.byCat[k]}</b> : null}</Link>)}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">{list.map((c) => <CommentCard key={c.id} c={c} canSend={canSend} />)}</div>
      {!list.length && <p className="card p-6 text-center text-sm text-slate-500">{stats.total ? 'لا توجد تعليقات في هذا القسم 👌' : 'لا توجد تعليقات بعد — اربط انستغرام أو الصق تعليقات بالأسفل.'}</p>}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card title={token.configured ? 'الربط مع انستغرام ✓' : 'الربط مع انستغرام (جلب تلقائي كل 30 دقيقة)'} collapsible><TokenCard configured={token.configured} /></Card>
        <Card title="لصق تعليقات يدويًا" collapsible><ImportBox accounts={accounts} /></Card>
      </div>
    </>
  );
}
