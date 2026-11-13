import { describe, expect, it } from 'vitest';
import { isMetricoolUrl, safeMetricoolBase, METRICOOL_DEFAULT_BASE } from '@/lib/publishing/metricool';
import nextConfig from '../../next.config.mjs';

describe('Metricool token never leaves Metricool (SSRF / token exfiltration)', () => {
  it('accepts only https Metricool hosts', () => {
    expect(isMetricoolUrl('https://app.metricool.com/api')).toBe(true);
    for (const bad of ['http://app.metricool.com/api', 'https://evil.example/api', 'https://app.metricool.com.evil.example/api', 'https://user:pw@app.metricool.com/api', 'https://app.metricool.com:8443/api', 'https://169.254.169.254/latest', 'not a url', '']) expect(isMetricoolUrl(bad)).toBe(false);
  });
  it('a tampered setting falls back to the official API instead of sending the token elsewhere', () => {
    expect(safeMetricoolBase('https://evil.example/api')).toBe(METRICOOL_DEFAULT_BASE);
    expect(safeMetricoolBase(undefined)).toBe(METRICOOL_DEFAULT_BASE);
    expect(safeMetricoolBase('https://app.metricool.com/api/')).toBe('https://app.metricool.com/api');
  });
});

describe('security headers', () => {
  it('sends anti-framing CSP, HSTS, nosniff and COOP on every route', async () => {
    const [rule] = await nextConfig.headers!();
    const h = Object.fromEntries(rule.headers.map((x: { key: string; value: string }) => [x.key, x.value]));
    expect(h['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/);
    expect(h['Content-Security-Policy']).toMatch(/object-src 'none'/);
    expect(h['Strict-Transport-Security']).toMatch(/max-age=31536000/);
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });
});
