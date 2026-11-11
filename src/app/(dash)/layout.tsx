import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { getSettings, secretStatus } from '@/lib/settings';
import { Sidebar, MobileNav } from '@/components/sidebar';
import { Badge } from '@/components/ui';

export const dynamic = 'force-dynamic';

const MODE_AR = { MANUAL: 'يدوي', ASSISTED: 'مساعد', AUTONOMOUS: 'ذاتي' } as const;

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [s, pending, unread, openai] = await Promise.all([getSettings(), prisma.approvalRequest.count({ where: { status: 'PENDING' } }), prisma.notification.count({ where: { readAt: null } }), secretStatus('OPENAI_API_KEY')]);
  return (
    <div className="flex min-h-screen">
      <Sidebar email={user.email} pendingApprovals={pending} unread={unread} />
      <div className="min-w-0 flex-1">
        <MobileNav />
        {s.killSwitch && <div className="bg-red-600 px-6 py-2 text-sm font-bold text-white">⛔ الإيقاف الطارئ مفعّل — كل عمليات النشر متوقفة. {s.killSwitchReason ?? ''} <Link className="underline" href="/schedule">إدارة</Link></div>}
        <header className="flex flex-wrap items-center gap-2 border-b bg-white px-6 py-3 text-xs">
          <span className="font-bold text-slate-500">وضع النشر:</span><Badge tone={s.publishingMode === 'AUTONOMOUS' ? 'red' : 'navy'}>{MODE_AR[s.publishingMode]}</Badge>
          <span className="font-bold text-slate-500">النشر الآلي:</span><Badge tone={s.autoPublishGlobal ? 'green' : 'slate'}>{s.autoPublishGlobal ? 'يعمل' : 'متوقف'}</Badge>
          <span className="font-bold text-slate-500">الذكاء الاصطناعي:</span><Badge tone={s.ai.dryRun ? 'amber' : openai.configured ? 'green' : 'red'}>{s.ai.dryRun ? 'وضع التجربة (بدون API)' : openai.configured ? 'OpenAI مباشر' : 'OpenAI غير مُعدّ'}</Badge>
          <span className="mr-auto text-slate-400">توقيت البحرين (Asia/Bahrain)</span>
        </header>
        <main className="mx-auto max-w-7xl p-6">{children}</main>
      </div>
    </div>
  );
}
