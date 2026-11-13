'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bell, CheckSquare, Home, Lightbulb, LogOut, Menu, Plus, X } from 'lucide-react';
import { NAV } from './sidebar';
import { cn } from './ui';
import { apiCall } from '@/lib/client/api';

/** Phone layout: compact top bar + fixed bottom tab bar (thumb reach) + «المزيد» sheet with every page. Hidden on desktop. */
export function MobileTopBar({ unread }: { unread: number }) {
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between bg-navy-950 px-4 py-3 text-white lg:hidden">
      <Link href="/" className="text-base font-extrabold text-gold-400">إبداع المستقبل</Link>
      <Link href="/alerts" className="relative rounded-full p-2 hover:bg-white/10" aria-label="التنبيهات">
        <Bell size={20} />
        {unread > 0 && <span className="absolute -left-0.5 -top-0.5 min-w-5 rounded-full bg-red-500 px-1 text-center text-[11px] font-bold leading-5">{unread > 99 ? '99+' : unread}</span>}
      </Link>
    </div>
  );
}

export function MobileTabBar({ pendingApprovals }: { pendingApprovals: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  const active = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
  const Tab = ({ href, label, icon: Icon, badge }: { href: string; label: string; icon: typeof Home; badge?: number }) => (
    <Link href={href} className={cn('relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold', active(href) ? 'text-gold-600' : 'text-slate-500')}>
      <Icon size={22} strokeWidth={active(href) ? 2.6 : 2} />{label}
      {!!badge && <span className="absolute right-[calc(50%-22px)] top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[11px] leading-5 text-white">{badge > 99 ? '99+' : badge}</span>}
    </Link>
  );
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><b className="text-navy-800">كل الصفحات</b><button onClick={() => setOpen(false)} aria-label="إغلاق" className="rounded-full p-2 hover:bg-slate-100"><X size={20} /></button></div>
            <div className="grid grid-cols-3 gap-2">
              {NAV.map(([href, label, Icon]) => (
                <Link key={href} href={href} className={cn('flex flex-col items-center gap-1 rounded-xl border p-3 text-center text-xs font-bold', active(href) ? 'border-gold-500 bg-gold-300/20 text-navy-900' : 'text-slate-700')}>
                  <Icon size={22} />{label}
                </Link>
              ))}
            </div>
            <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-bold text-slate-600" onClick={async () => { await apiCall('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }}><LogOut size={16} /> تسجيل الخروج</button>
          </div>
        </div>
      )}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-end border-t bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden">
        <Tab href="/" label="الرئيسية" icon={Home} />
        <Tab href="/approvals" label="الموافقات" icon={CheckSquare} badge={pendingApprovals} />
        <Link href="/create" aria-label="إنشاء تصميم" className="flex flex-1 justify-center">
          <span className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-gold-500 text-navy-950 shadow-lg ring-4 ring-white"><Plus size={28} strokeWidth={2.8} /></span>
        </Link>
        <Tab href="/ideas" label="الأفكار" icon={Lightbulb} />
        <button onClick={() => setOpen(true)} className={cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold', open ? 'text-gold-600' : 'text-slate-500')}><Menu size={22} />المزيد</button>
      </nav>
    </>
  );
}
