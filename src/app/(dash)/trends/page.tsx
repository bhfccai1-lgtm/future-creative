import { requirePageUser } from '@/lib/auth/server';
import { can } from '@/lib/auth/rbac';
import { getSettings } from '@/lib/settings';
import { lastRadar, trendIdeas } from '@/lib/growth/trends';
import { PageHeader } from '@/components/ui';
import { TrendRadarView } from '@/components/trend-radar';

export const dynamic = 'force-dynamic';

export default async function TrendsPage() {
  const user = await requirePageUser('dashboard:view');
  const [radar, ideas, s] = await Promise.all([lastRadar(), trendIdeas(), getSettings()]);
  return (
    <>
      <PageHeader title="🔥 رادار الترند" subtitle="ما يبحث عنه الناس اليوم في البحرين والسعودية (Google Trends) — الأخبار الحزينة والسياسية تُستبعد تلقائيًا، والذكاء الاصطناعي يربط الترند الآمن بمنتج وحساب مناسبين ويضع الفكرة في بنك الأفكار لتعتمدها." />
      <TrendRadarView radar={radar} ideas={JSON.parse(JSON.stringify(ideas))} settings={s.trends} canCreate={can(user.perms, 'ads:create')} canControl={can(user.perms, 'automation:control')} />
    </>
  );
}
