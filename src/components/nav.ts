import { Rocket, Lightbulb, Repeat, LayoutDashboard, Users, PlusCircle, Sparkles, Package, Images, CalendarClock, CheckSquare, CalendarDays, History, BarChart3, AlertTriangle, BadgeCheck, Bot, PlugZap, LogOut, FileBarChart, Stethoscope, Swords, PartyPopper, MessageCircle, TrendingUp, Contact, Camera, GraduationCap, Printer, UserCog, ClipboardList, MessageSquareText, Flame } from 'lucide-react';

export type NavItem = readonly [string, string, typeof LayoutDashboard];
/** the menu in groups that follow the daily work: make → publish → sell → measure → studios → settings */
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: '', items: [['/', 'لوحة التحكم', LayoutDashboard], ['/assistant', 'المساعد الذكي', MessageSquareText], ['/setup', 'مركز التفعيل', Rocket]] },
  { title: 'المحتوى', items: [['/create', 'إنشاء تصميم جديد', PlusCircle], ['/ideas', 'بنك الأفكار', Lightbulb], ['/ai-designer', 'مصمم الإعلانات AI', Sparkles], ['/library', 'مكتبة التصاميم', Images], ['/portfolio', 'أعمال منجزة', Camera], ['/occasions', 'تقويم المناسبات', PartyPopper]] },
  { title: 'النشر', items: [['/approvals', 'طابور الموافقات', CheckSquare], ['/schedule', 'جدول النشر الآلي', CalendarClock], ['/campaigns', 'الحملات المتكررة', Repeat], ['/calendar', 'التقويم', CalendarDays], ['/posts', 'سجل المنشورات', History], ['/accounts', 'الحسابات الاجتماعية', Users]] },
  { title: 'العملاء والمبيعات', items: [['/comments', 'التعليقات والردود', MessageCircle], ['/leads', 'العملاء والطلبات', Contact]] },
  { title: 'النمو والتحليل', items: [['/accounts-plan', 'خطة الحسابات', ClipboardList], ['/trends', 'رادار الترند', Flame], ['/growth', 'برنامج النمو 30 يومًا', TrendingUp], ['/analytics', 'تحليلات الأداء', BarChart3], ['/reports', 'التقارير والتجارب', FileBarChart], ['/competitors', 'تحليل المنافسين', Swords]] },
  { title: 'الاستوديوهات', items: [['/print-studio', 'PRINT DESIGN STUDIO', Printer], ['/education-master', 'EDUCATION MASTER AI', GraduationCap], ['/products', 'المنتجات والخدمات', Package]] },
  { title: 'النظام', items: [['/alerts', 'الأخطاء والتنبيهات', AlertTriangle], ['/diagnostics', 'تشخيص النظام', Stethoscope], ['/settings/brand', 'إعدادات الهوية', BadgeCheck], ['/settings/ai', 'إعدادات الذكاء الاصطناعي', Bot], ['/settings/integrations', 'إعدادات الربط', PlugZap], ['/settings/users', 'المستخدمون والصلاحيات', UserCog]] },
];
/** a menu item is active on its own page and its sub-pages only («/accounts» is not active on «/accounts-plan») */
export const isActivePath = (path: string, href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));
/** flat list (mobile «more» sheet, search) */
export const NAV: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);
