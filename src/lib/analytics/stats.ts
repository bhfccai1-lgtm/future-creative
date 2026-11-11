/** Small, dependency-free statistics used by the growth engine. Deliberately conservative. */
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export function variance(xs: number[]) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}

// Regularised incomplete beta (Numerical Recipes, continued fraction) → Student-t CDF.
function lnGamma(z: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  const x = z; let y = z; let tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015;
  for (const c of g) ser += c / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a: number, b: number, x: number) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1); if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function ibeta(a: number, b: number, x: number) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}
/** Two-sided p-value for a t statistic with df degrees of freedom. */
export function tTestP(t: number, df: number) { return ibeta(df / 2, 0.5, df / (df + t * t)); }

/** Welch's t-test (unequal variances). Returns NaN p when either group has < 2 observations. */
export function welch(a: number[], b: number[]) {
  const va = variance(a), vb = variance(b);
  if (!(a.length >= 2 && b.length >= 2) || !Number.isFinite(va) || !Number.isFinite(vb)) return { t: NaN, df: NaN, p: NaN };
  const se2 = va / a.length + vb / b.length;
  if (se2 === 0) return { t: 0, df: a.length + b.length - 2, p: mean(a) === mean(b) ? 1 : 0 };
  const t = (mean(a) - mean(b)) / Math.sqrt(se2);
  const df = se2 ** 2 / ((va / a.length) ** 2 / (a.length - 1) + (vb / b.length) ** 2 / (b.length - 1));
  return { t, df, p: tTestP(Math.abs(t), df) };
}

/** Per-group sample size for ~80% power at α=0.05 to detect `diff` given pooled sd (Lehr's rule: 16σ²/δ²). */
export function samplesNeeded(sd: number, diff: number) {
  if (!(sd > 0) || !(Math.abs(diff) > 0)) return null;
  return Math.ceil((16 * sd * sd) / (diff * diff));
}

export const MIN_SAMPLE = 5;
