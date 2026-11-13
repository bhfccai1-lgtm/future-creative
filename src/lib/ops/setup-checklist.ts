import { prisma } from '../db';
import { getSettings, secretStatus } from '../settings';
import { linkedNetworks } from '../publishing/channels';

/**
 * «مركز التفعيل»: every capability of the system with its LIVE status (read from settings and data, never assumed),
 * in the order that gives results fastest, each with the exact page/button to finish it.
 */
export type Group = 'basics' | 'content' | 'reach' | 'integrations';
export interface SetupItem { id: string; group: Group; title: string; why: string; done: boolean; detail?: string; href: string; cta: string; optional?: boolean }

export const GROUP_AR: Record<Group, string> = { basics: '1. الأساسيات — بدونها لا يعمل شيء', content: '2. جودة المحتوى', reach: '3. الانتشار والنمو', integrations: '4. الربط والأتمتة' };

export async function setupChecklist(): Promise<{ items: SetupItem[]; done: number; total: number; next: SetupItem | null }> {
  const s = await getSettings();
  const [openai, accounts, connected, ideas, recentMetrics, archive, telegram, catalogToken] = await Promise.all([
    secretStatus('OPENAI_API_KEY'),
    prisma.socialAccount.findMany({ select: { formatStrategy: true, autoPublishEnabled: true, autoChannels: true, gbpAuto: true, allowedCategoryIds: true, connection: { select: { status: true, providerSnapshot: true } } } }),
    prisma.socialConnection.count({ where: { status: 'CONNECTED', canPublish: true } }),
    prisma.idea.count({ where: { status: { in: ['NEW', 'APPROVED', 'USED'] } } }),
    prisma.publicationResult.count({ where: { metricsFetchedAt: { gte: new Date(Date.now() - 7 * 86400_000) } } }),
    secretStatus('GOOGLE_ARCHIVE_URL'),
    secretStatus('TELEGRAM_BOT_TOKEN'),
    secretStatus('META_CATALOG_TOKEN'),
  ]);
  const n = accounts.length;
  const mix = accounts.filter((a) => a.formatStrategy === 'GROWTH_MIX').length;
  const auto = accounts.filter((a) => a.autoPublishEnabled).length;
  const withChannels = accounts.filter((a) => a.autoChannels.length).length;
  const unusedChannels = accounts.filter((a) => linkedNetworks(a.connection?.providerSnapshot).some((x) => x !== 'gmb' && !a.autoChannels.includes(x as never))).length;
  const gbpLinked = accounts.filter((a) => linkedNetworks(a.connection?.providerSnapshot).includes('gmb'));
  const items: SetupItem[] = [
    { id: 'ai', group: 'basics', title: 'الذكاء الاصطناعي يعمل فعليًا', why: 'في «وضع التجربة» التصاميم وهمية ولا تُنشر.', done: openai.configured && !s.ai.dryRun, detail: !openai.configured ? 'مفتاح OpenAI غير مُدخل' : s.ai.dryRun ? 'وضع التجربة مفعّل' : undefined, href: '/settings/ai', cta: 'إعدادات الذكاء الاصطناعي' },
    { id: 'metricool', group: 'basics', title: 'الحسابات مرتبطة بصلاحية نشر', why: 'النشر يمر عبر Metricool فقط.', done: n > 0 && connected >= n, detail: `${connected} من ${n} حساب`, href: '/accounts', cta: 'فحص كل الحسابات' },
    { id: 'recommended', group: 'basics', title: 'الإعداد الموصى به (مزيج النمو والفئات)', why: 'الريلز وصلت حتى 10× أكثر من الصور في حساباتك.', done: n > 0 && mix === n, detail: `${mix} من ${n} على مزيج النمو`, href: '/schedule', cta: 'تطبيق الإعداد الموصى به' },
    { id: 'autopublish', group: 'basics', title: 'النشر الآلي يعمل', why: 'الاستمرارية أهم إشارة للخوارزمية.', done: s.autoPublishGlobal && auto > 0, detail: !s.autoPublishGlobal ? 'متوقف عامًا' : `${auto} حساب مفعّل`, href: '/schedule', cta: 'التحكم في الأتمتة' },
    { id: 'quality', group: 'content', title: 'الجودة الاحترافية', why: 'صور عالية الجودة + المخرج الفني يختار الأفضل من صورتين.', done: s.ai.bestOf >= 2 && s.ai.qualityByFormat.REEL_VIDEO !== 'low' && (s.ai.qualityByFormat.IMAGE_FEED || s.ai.imageQuality) === 'high', detail: `${s.ai.bestOf} صورة لكل تصميم`, href: '/settings/ai', cta: '⭐ تطبيق الجودة الاحترافية' },
    { id: 'concepts', group: 'content', title: 'الأفكار البصرية المميزة', why: '10 أفكار إبداعية تتناوب حتى لا يتشابه تصميمان.', done: s.ai.creativeConcepts, href: '/settings/ai', cta: 'استوديو الإبداع' },
    { id: 'ideas', group: 'content', title: 'بنك الأفكار', why: 'أفكار مقيّمة من زوايا مجربة، يستخدمها النشر الآلي تلقائيًا.', done: s.ideas.weekly && ideas > 0, detail: `${ideas} فكرة`, href: '/ideas', cta: 'ولّد أفكارًا الآن' },
    { id: 'peak', group: 'reach', title: 'النشر في ساعات الذروة', why: 'ينتظر أقرب ساعة ذروة بدل النشر في ساعة ضعيفة.', done: s.growth.peakHours.enabled, href: '/schedule', cta: 'الانتشار السريع' },
    { id: 'winners', group: 'reach', title: 'ضاعف الناجح', why: 'ريلز جديدة أسبوعيًا من أفضل منشوراتك أداءً.', done: s.growth.winners.enabled, href: '/schedule', cta: 'الانتشار السريع' },
    { id: 'crosspromo', group: 'reach', title: 'الترويج المتبادل', why: 'الحسابات الكبيرة (آلاف المتابعين) تنقل جمهورها للحسابات المتخصصة.', done: s.publishing.crossPromo.enabled, href: '/schedule', cta: 'الترويج المتبادل' },
    { id: 'channels', group: 'reach', title: 'كل القنوات المرتبطة', why: 'نفس التصميم على فيسبوك وتيك توك وغيرها بلا تكلفة توليد إضافية.', done: unusedChannels === 0, detail: unusedChannels ? `${unusedChannels} حساب له قنوات غير مستخدمة` : withChannels ? `${withChannels} حساب متعدد القنوات` : undefined, href: '/accounts', cta: 'انشر على كل القنوات المرتبطة' },
    { id: 'gbp', group: 'reach', title: 'Google Business تلقائيًا', why: 'يظهر في الخرائط والبحث المحلي («مطبعة قريبة مني»).', done: gbpLinked.length > 0 && gbpLinked.every((a) => a.gbpAuto), detail: gbpLinked.length ? `${gbpLinked.filter((a) => a.gbpAuto).length} من ${gbpLinked.length}` : 'لا يوجد ملف Google مرتبط في Metricool', href: '/accounts', cta: 'إعدادات الحساب', optional: !gbpLinked.length },
    { id: 'metrics', group: 'reach', title: 'مقاييس الأداء تُستورد', why: 'بدونها لا تتعلم ساعات الذروة ولا «ضاعف الناجح» ولا بنك الأفكار.', done: recentMetrics > 0, detail: `${recentMetrics} منشور بمقاييس (7 أيام)`, href: '/reports', cta: 'استيراد المقاييس' },
    { id: 'telegram', group: 'integrations', title: 'تيليجرام للتنبيهات والموافقات', why: 'تصلك التصاميم والتنبيهات على هاتفك فورًا.', done: telegram.configured && !!s.n8n.telegramChatId, href: '/settings/integrations', cta: 'إعدادات n8n' },
    { id: 'archive', group: 'integrations', title: 'أرشيف Google Drive', why: 'نسخة من كل منشور مؤكد + سجل في جدول.', done: archive.configured, href: '/settings/integrations', cta: 'أرشيف Google Drive', optional: true },
    { id: 'whatsapp', group: 'integrations', title: 'أرقام واتساب وحزمة الحالة', why: 'أرقامك الأربعة في صفحات المنتجات، وحالة جاهزة يوميًا.', done: s.whatsapp.numbers.length > 0 && s.whatsapp.statusPack.enabled, detail: `${s.whatsapp.numbers.length} رقم · حزمة الحالة ${s.whatsapp.statusPack.enabled ? 'مفعّلة' : 'متوقفة'}`, href: '/settings/integrations', cta: 'إعدادات واتساب', optional: true },
    { id: 'catalog', group: 'integrations', title: 'كتالوج واتساب', why: 'منتجاتك داخل واتساب للأعمال (يحتاج أسعارًا).', done: catalogToken.configured && s.whatsapp.catalog.enabled && s.whatsapp.catalog.lastSyncOk, href: '/settings/integrations', cta: 'إعدادات واتساب', optional: true },
  ];
  const required = items.filter((i) => !i.optional);
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, next: required.find((i) => !i.done) ?? items.find((i) => !i.done) ?? null };
}
