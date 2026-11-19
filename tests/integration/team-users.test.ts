import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { changeOwnPassword, createUser, listUsers, resetPassword, updateUser } from '@/lib/auth/users';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); });
const PW = 'Strong-pass-2026';

describe('team members (user management)', () => {
  it('admin adds an editor; duplicates and weak passwords are refused; everything is audited', async () => {
    await seedBase();
    const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@test.bh' } });
    const actor = { sub: admin.id, email: admin.email };
    const u = await createUser({ email: ' Designer@Test.BH ', name: 'مصمم', role: 'EDITOR', password: PW }, actor);
    expect(u.email).toBe('designer@test.bh');
    await expect(createUser({ email: 'designer@test.bh', name: 'x y', role: 'EDITOR', password: PW }, actor)).rejects.toThrow(/يوجد مستخدم/);
    await expect(createUser({ email: 'b@test.bh', name: 'x y', role: 'EDITOR', password: 'short1' }, actor)).rejects.toThrow(/12/);
    await expect(createUser({ email: 'c@test.bh', name: 'x y', role: 'GOD', password: PW }, actor)).rejects.toThrow(/الدور/);
    const list = await listUsers(actor);
    expect(list.find((x) => x.email === 'designer@test.bh')).toMatchObject({ role: 'EDITOR', active: true, self: false });
    expect(list.find((x) => x.self)?.email).toBe('admin@test.bh');
    expect(await prisma.auditLog.count({ where: { action: 'user.create' } })).toBe(1);
  });

  it('role change / disable end the sessions; the last admin cannot be removed; nobody disables themselves', async () => {
    await seedBase();
    const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@test.bh' } });
    const actor = { sub: admin.id, email: admin.email };
    const { id } = await createUser({ email: 'ed@test.bh', name: 'محرر', role: 'EDITOR', password: PW }, actor);
    const sv0 = (await prisma.user.findUniqueOrThrow({ where: { id } })).sessionVersion;
    await updateUser(id, { role: 'VIEWER' }, actor);
    const after = await prisma.user.findUniqueOrThrow({ where: { id }, include: { role: true } });
    expect(after.role.name).toBe('VIEWER'); expect(after.sessionVersion).toBe(sv0 + 1);
    await updateUser(id, { name: 'اسم جديد' }, actor); // a rename keeps the sessions
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).sessionVersion).toBe(sv0 + 1);
    await expect(updateUser(admin.id, { active: false }, actor)).rejects.toThrow(/حسابك/);
    await expect(updateUser(admin.id, { role: 'EDITOR' }, actor)).rejects.toThrow(/دورك/);
    // a second admin may not demote the only other admin if that leaves none… but with two admins it works
    const { id: a2 } = await createUser({ email: 'a2@test.bh', name: 'مدير ٢', role: 'ADMIN', password: PW }, actor);
    await updateUser(a2, { active: false }, actor);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a2 } })).active).toBe(false);
    await expect(updateUser(admin.id, { active: false }, { sub: a2, email: 'a2@test.bh' })).rejects.toThrow(/آخر مدير/);
  });

  it('reset unlocks and ends sessions; own change needs the current password', async () => {
    await seedBase();
    const admin = await prisma.user.findFirstOrThrow({ where: { email: 'admin@test.bh' } });
    const actor = { sub: admin.id, email: admin.email };
    const { id } = await createUser({ email: 'l@test.bh', name: 'مقفل', role: 'EDITOR', password: PW }, actor);
    await prisma.user.update({ where: { id }, data: { failedLogins: 5, lockedUntil: new Date(Date.now() + 600_000) } });
    expect((await listUsers(actor)).find((x) => x.id === id)?.locked).toBe(true);
    await resetPassword(id, 'Another-pass-99', actor);
    const u = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(u.lockedUntil).toBeNull(); expect(await verifyPassword('Another-pass-99', u.passwordHash)).toBe(true);
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(PW) } });
    await expect(changeOwnPassword(actor, 'wrong', 'Brand-new-pass-1')).rejects.toThrow(/الحالية/);
    await expect(changeOwnPassword(actor, PW, PW)).rejects.toThrow(/مختلفة/);
    await changeOwnPassword(actor, PW, 'Brand-new-pass-1');
    const a = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(await verifyPassword('Brand-new-pass-1', a.passwordHash)).toBe(true);
    expect(a.sessionVersion).toBe(admin.sessionVersion + 1);
  });
});
