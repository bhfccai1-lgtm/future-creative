import { describe, expect, it } from 'vitest';
import { NAV, NAV_GROUPS, isActivePath } from '@/components/nav';

describe('navigation', () => {
  it('every page is listed once, in groups', () => {
    const hrefs = NAV.map(([h]) => h);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(expect.arrayContaining(['/accounts-plan', '/settings/users', '/print-studio', '/education-master', '/approvals']));
    expect(NAV_GROUPS.filter((g) => g.title).length).toBeGreaterThanOrEqual(5);
  });
  it('a page does not light up a sibling that only shares a prefix', () => {
    expect(isActivePath('/accounts-plan', '/accounts')).toBe(false);
    expect(isActivePath('/accounts/abc', '/accounts')).toBe(true);
    expect(isActivePath('/accounts-plan', '/accounts-plan')).toBe(true);
    expect(isActivePath('/ads/1', '/')).toBe(false);
  });
});
