/** Create or reset an administrator. Usage: ADMIN_EMAIL=.. ADMIN_PASSWORD=.. npm run admin:create */
import { PrismaClient } from '@prisma/client';
import { hashPassword, passwordPolicyError } from '../src/lib/auth/password';

const prisma = new PrismaClient();
async function main() {
  const email = (process.env.ADMIN_EMAIL ?? process.argv[2] ?? '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? process.argv[3] ?? '';
  const name = process.env.ADMIN_NAME ?? 'مدير النظام';
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  const err = passwordPolicyError(password); if (err) throw new Error(err);
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({ where: { email }, create: { email, name, passwordHash, roleId: role.id }, update: { passwordHash, roleId: role.id, active: true, failedLogins: 0, lockedUntil: null, sessionVersion: { increment: 1 } } });
  console.log(`Administrator ready: ${email}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());
