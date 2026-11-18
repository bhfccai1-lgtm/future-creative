/**
 * Human "publish anyway" override of the quality check (نشر الآن بدون فحص الجودة).
 * Stored on the ad as options.qcOverride by a named person, with the failed checks at that moment.
 * It never bypasses: dry-run media, the kill switch, account pause/connection, logo integrity or the SHA-256 approval binding.
 */
export type QcOverride = { by: string; at: string; reason: string | null; failed: string[] };

export function qcOverrideOf(ad: { options?: unknown }): QcOverride | null {
  const o = (ad.options ?? null) as { qcOverride?: QcOverride } | null;
  return o?.qcOverride?.by ? o.qcOverride : null;
}

export const hasQcOverride = (ad: { options?: unknown }) => qcOverrideOf(ad) !== null;
