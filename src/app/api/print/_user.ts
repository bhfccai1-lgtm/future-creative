/** The signed-in user as the PRINT DESIGN STUDIO service expects it. */
export const printUser = (u: { sub: string; email: string } & { perms?: readonly string[] }) => ({ sub: u.sub, email: u.email, perms: u.perms ?? [] });
