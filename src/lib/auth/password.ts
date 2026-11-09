import bcrypt from 'bcryptjs';

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function passwordPolicyError(pw: string): string | null {
  if (pw.length < 12) return 'كلمة المرور يجب أن تكون 12 حرفًا على الأقل';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'كلمة المرور يجب أن تحتوي على أحرف وأرقام';
  return null;
}
