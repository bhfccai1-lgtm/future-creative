import { requirePageUser } from '@/lib/auth/server';
import { can } from '@/lib/auth/rbac';
import { accountPlans } from '@/lib/growth/account-plan';
import { PageHeader } from '@/components/ui';
import { AccountsPlan } from '@/components/accounts-plan';

export const dynamic = 'force-dynamic';

export default async function AccountsPlanPage() {
  const user = await requirePageUser('dashboard:view');
  const plans = await accountPlans({ days: 30 });
  return (
    <>
      <PageHeader title="خطة الحسابات" subtitle="لكل حساب: أفضل منشور ولماذا، المشاكل وحلولها، أفكار مبنية على ما نجح، بايو جاهز ورسائل للعملاء — من أرقام Metricool لآخر ٣٠ يومًا. نفّذ الأفكار بضغطة: اعتمدها للجدول الآلي أو صمّمها الآن." />
      <AccountsPlan plans={JSON.parse(JSON.stringify(plans))} canCreate={can(user.perms, 'ads:create')} />
    </>
  );
}
