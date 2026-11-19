import { prisma } from '../db';
import { audit } from '../audit';
import { AppError } from '../errors';
import { hashPassword, passwordPolicyError, verifyPassword } from './password';

/**
 * TEAM MEMBERS: the administrator adds staff with a role (ADMIN / EDITOR / VIEWER), changes roles, disables accounts,
 * unlocks them and sets a new password. Every change is audited; changing a role, disabling or resetting a password
 * ends that person's open sessions (sessionVersion). The system never leaves itself without an active administrator.
 */
type Actor = { sub: string; email: string };
export interface TeamMember { id: string; email: string; name: string; role: string; active: boolean; locked: boolean; lastLoginAt: Date | null; createdAt: Date; self: boolean }

export const ROLE_AR: Record<string, string> = { ADMIN: 'مدير (كل الصلاحيات)', EDITOR: 'محرر (تصميم، موافقة، نشر)', VIEWER: 'مشاهدة فقط' };

export async function listUsers(actor: Actor): Promise<TeamMember[]> {
  const rows = await prisma.user.findMany({ include: { role: true }, orderBy: [{ active: 'desc' }, { createdAt: 'asc' }] });
  const now = new Date();
  return rows.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role.name, active: u.active, locked: !!u.lockedUntil && u.lockedUntil > now, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, self: u.id === actor.sub }));
}
export async function listRoles() {
  return (await prisma.role.findMany({ orderBy: { name: 'asc' } })).map((r) => ({ name: r.name, ar: ROLE_AR[r.name] ?? r.name, permissions: r.permissions }));
}

async function roleId(name: string) {
  const r = await prisma.role.findUnique({ where: { name } });
  if (!r) throw new AppError('ROLE', 'الدور غير موجود.', 422);
  return r.id;
}
function checkPassword(pw: string) { const e = passwordPolicyError(pw); if (e) throw new AppError('PASSWORD', e, 422); }
/** at least one active ADMIN must remain after the change */
async function keepAnAdmin(exceptId: string) {
  const n = await prisma.user.count({ where: { active: true, role: { name: 'ADMIN' }, id: { not: exceptId } } });
  if (n === 0) throw new AppError('LAST_ADMIN', 'لا يمكن ذلك: هذا آخر مدير نشط في النظام — أضف مديرًا آخر أولًا.', 409);
}

export async function createUser(input: { email: string; name: string; role: string; password: string }, actor: Actor) {
  const email = input.email.trim().toLowerCase();
  checkPassword(input.password);
  if (await prisma.user.findUnique({ where: { email } })) throw new AppError('EXISTS', 'يوجد مستخدم بهذا البريد.', 409);
  const u = await prisma.user.create({ data: { email, name: input.name.trim(), roleId: await roleId(input.role), passwordHash: await hashPassword(input.password) } });
  await audit({ actorId: actor.sub, actorLabel: actor.email, action: 'user.create', targetType: 'user', targetId: u.id, details: { email, role: input.role } });
  return { id: u.id, email: u.email };
}

export async function updateUser(id: string, input: { name?: string; role?: string; active?: boolean; unlock?: boolean }, actor: Actor) {
  const u = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!u) throw new AppError('NOT_FOUND', 'المستخدم غير موجود.', 404);
  const self = id === actor.sub;
  if (self && input.active === false) throw new AppError('SELF', 'لا يمكنك تعطيل حسابك أنت.', 409);
  if (self && input.role && input.role !== u.role.name) throw new AppError('SELF', 'لا يمكنك تغيير دورك أنت — اطلب ذلك من مدير آخر.', 409);
  const losesAdmin = u.role.name === 'ADMIN' && u.active && ((input.role && input.role !== 'ADMIN') || input.active === false);
  if (losesAdmin) await keepAnAdmin(id);
  const roleChanged = !!input.role && input.role !== u.role.name;
  const disabled = input.active === false && u.active;
  await prisma.user.update({
    where: { id },
    data: {
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
      ...(roleChanged ? { roleId: await roleId(input.role!) } : {}),
      ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
      ...(input.unlock ? { failedLogins: 0, lockedUntil: null } : {}),
      // a new role or a disabled account takes effect at once: open sessions end
      ...(roleChanged || disabled ? { sessionVersion: { increment: 1 } } : {}),
    },
  });
  await audit({ actorId: actor.sub, actorLabel: actor.email, action: 'user.update', targetType: 'user', targetId: id, details: { email: u.email, ...(roleChanged ? { role: `${u.role.name}→${input.role}` } : {}), ...(typeof input.active === 'boolean' ? { active: input.active } : {}), ...(input.unlock ? { unlock: true } : {}) } });
  return { ok: true };
}

/** the administrator sets a new password for someone (forgotten password): unlocks and ends their sessions */
export async function resetPassword(id: string, password: string, actor: Actor) {
  checkPassword(password);
  const u = await prisma.user.findUnique({ where: { id } });
  if (!u) throw new AppError('NOT_FOUND', 'المستخدم غير موجود.', 404);
  await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null, sessionVersion: { increment: 1 } } });
  await audit({ actorId: actor.sub, actorLabel: actor.email, action: 'user.password_reset', targetType: 'user', targetId: id, details: { email: u.email } });
  return { ok: true };
}

/** anyone changes their own password (the current one is required); all their sessions end — they sign in again */
export async function changeOwnPassword(actor: Actor, current: string, next: string) {
  const u = await prisma.user.findUnique({ where: { id: actor.sub } });
  if (!u) throw new AppError('NOT_FOUND', 'المستخدم غير موجود.', 404);
  if (!(await verifyPassword(current, u.passwordHash))) throw new AppError('WRONG_PASSWORD', 'كلمة المرور الحالية غير صحيحة.', 422);
  checkPassword(next);
  if (current === next) throw new AppError('SAME', 'اختر كلمة مرور جديدة مختلفة عن الحالية.', 422);
  await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } } });
  await audit({ actorId: u.id, actorLabel: u.email, action: 'user.password_change', targetType: 'user', targetId: u.id });
  return { ok: true };
}
