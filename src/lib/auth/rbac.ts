export const PERMISSIONS = [
  'dashboard:view',
  'accounts:manage',
  'products:manage',
  'ads:create',
  'ads:approve',
  'publish:now',
  'automation:control', // start/stop auto-publishing, scheduler modes
  'autonomy:authorize', // authorise autonomous publishing (admin only)
  'killswitch:toggle',
  'brand:manage',
  'settings:ai',
  'settings:integrations',
  'users:manage',
  'audit:view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const DEFAULT_ROLES: Record<string, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  EDITOR: ['dashboard:view', 'ads:create', 'ads:approve', 'publish:now', 'products:manage', 'killswitch:toggle'],
  VIEWER: ['dashboard:view'],
};

export function can(perms: readonly string[], p: Permission) { return perms.includes(p); }
