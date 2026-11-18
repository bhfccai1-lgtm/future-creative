/** The signed-in user as the EDUCATION MASTER service expects it. */
export const eduUser = (u: { sub: string; email: string } & { perms?: readonly string[] }) => ({ sub: u.sub, email: u.email, perms: u.perms ?? [] });
