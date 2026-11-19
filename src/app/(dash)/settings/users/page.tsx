import { requirePageUser } from '@/lib/auth/server';
import { can } from '@/lib/auth/rbac';
import { listRoles, listUsers } from '@/lib/auth/users';
import { Card, PageHeader } from '@/components/ui';
import { ChangeMyPassword, TeamUsers } from '@/components/team-users';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const me = await requirePageUser('dashboard:view');
  const admin = can(me.perms, 'users:manage');
  const [users, roles] = admin ? await Promise.all([listUsers(me), listRoles()]) : [[], []];
  return (
    <>
      <PageHeader title="المستخدمون والصلاحيات" subtitle={admin ? 'أضف فريق العمل بدور مناسب: المحرر يصمم ويوافق وينشر، المشاهد يرى فقط، المدير يملك كل الإعدادات. كل تغيير يُسجَّل في سجل التدقيق.' : 'غيّر كلمة المرور الخاصة بك.'} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        {admin && (
          <Card title={`👥 فريق العمل (${users.filter((u) => u.active).length} نشط)`}>
            <TeamUsers users={users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null }))} roles={roles} />
          </Card>
        )}
        <Card title="🔑 كلمة المرور الخاصة بي"><ChangeMyPassword /></Card>
      </div>
    </>
  );
}
