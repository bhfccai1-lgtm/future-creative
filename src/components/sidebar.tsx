'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Rocket, Lightbulb, Repeat, LayoutDashboard, Users, PlusCircle, Sparkles, Package, Images, CalendarClock, CheckSquare, CalendarDays, History, BarChart3, AlertTriangle, BadgeCheck, Bot, PlugZap, LogOut, FileBarChart, Stethoscope, Swords, PartyPopper } from 'lucide-react';
import { cn } from './ui';
import { apiCall } from '@/lib/client/api';

export const NAV = [
  ['/', 'لوحة التحكم', LayoutDashboard], ['/setup', 'مركز التفعيل', Rocket], ['/accounts', 'الحسابات الاجتماعية', Users], ['/create', 'إنشاء تصميم جديد', PlusCircle], ['/ideas', 'بنك الأفكار', Lightbulb],
  ['/ai-designer', 'مصمم الإعلانات AI', Sparkles], ['/products', 'المنتجات والخدمات', Package], ['/library', 'مكتبة التصاميم', Images],
  ['/campaigns', 'الحملات المتكررة', Repeat], ['/schedule', 'جدول النشر الآلي', CalendarClock], ['/approvals', 'طابور الموافقات', CheckSquare], ['/calendar', 'التقويم', CalendarDays], ['/occasions', 'تقويم المناسبات', PartyPopper],
  ['/posts', 'سجل المنشورات', History], ['/analytics', 'تحليلات الأداء', BarChart3], ['/reports', 'التقارير والتجارب', FileBarChart], ['/competitors', 'تحليل المنافسين', Swords], ['/alerts', 'الأخطاء والتنبيهات', AlertTriangle], ['/diagnostics', 'تشخيص النظام', Stethoscope],
  ['/settings/brand', 'إعدادات الهوية', BadgeCheck], ['/settings/ai', 'إعدادات الذكاء الاصطناعي', Bot], ['/settings/integrations', 'إعدادات الربط', PlugZap],
] as const;

export function Sidebar({ email, pendingApprovals, unread }: { email: string; pendingApprovals: number; unread: number }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-navy-950 text-slate-200 lg:flex">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="text-lg font-extrabold text-gold-400">إبداع المستقبل</div>
        <div className="text-xs text-slate-400">نظام النشر الإعلاني الذكي</div>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-3">
        {NAV.map(([href, label, Icon]) => {
          const active = href === '/' ? path === '/' : path.startsWith(href);
          const count = href === '/approvals' ? pendingApprovals : href === '/alerts' ? unread : 0;
          return (
            <Link key={href} href={href} className={cn('mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition', active ? 'bg-gold-500 text-navy-950' : 'hover:bg-white/5')}>
              <Icon size={17} /><span className="flex-1">{label}</span>
              {count > 0 && <span className={cn('rounded-full px-2 text-xs', active ? 'bg-navy-900 text-white' : 'bg-red-500 text-white')}>{count}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/10 p-4 text-xs">
        <div className="mb-2 truncate text-slate-400 ltr">{email}</div>
        <button className="flex items-center gap-2 text-slate-300 hover:text-white" onClick={async () => { await apiCall('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }}><LogOut size={14} /> تسجيل الخروج</button>
      </div>
    </aside>
  );
}
