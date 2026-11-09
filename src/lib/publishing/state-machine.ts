import type { AdState } from '@prisma/client';

/**
 * Explicit advertisement / publication state machine (section 12).
 * SCHEDULED → PUBLISHED is only allowed via provider verification (enforced in reconcile.ts).
 */
export const TRANSITIONS: Record<AdState, AdState[]> = {
  DRAFT: ['GENERATING', 'REJECTED'],
  GENERATING: ['GENERATED', 'FAILED'],
  GENERATED: ['QUALITY_REVIEW', 'FAILED'],
  QUALITY_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['QUEUED', 'REJECTED'],
  QUEUED: ['PUBLISHING', 'REJECTED', 'FAILED'],
  PUBLISHING: ['SCHEDULED', 'PUBLISHED', 'FAILED', 'UNKNOWN', 'QUEUED'], // QUEUED only after a definitive non-acceptance (e.g. 429)
  SCHEDULED: ['PUBLISHED', 'FAILED', 'UNKNOWN'],
  UNKNOWN: ['SCHEDULED', 'PUBLISHED', 'FAILED', 'QUEUED'], // QUEUED only after reconciliation proves absence
  PUBLISHED: [],
  FAILED: ['QUEUED', 'QUALITY_REVIEW'], // explicit admin retry
  REJECTED: [],
};

export class InvalidTransitionError extends Error {
  constructor(public from: AdState, public to: AdState) { super(`Invalid state transition ${from} → ${to}`); }
}

export function canTransition(from: AdState, to: AdState) { return TRANSITIONS[from].includes(to); }
export function assertTransition(from: AdState, to: AdState) { if (!canTransition(from, to)) throw new InvalidTransitionError(from, to); }

export const STATE_LABEL_AR: Record<AdState, string> = {
  DRAFT: 'مسودة', GENERATING: 'قيد التوليد', GENERATED: 'تم التوليد', QUALITY_REVIEW: 'مراجعة الجودة', APPROVED: 'معتمد',
  QUEUED: 'في الطابور', SCHEDULED: 'مجدول لدى المزود', PUBLISHING: 'قيد الإرسال', PUBLISHED: 'منشور (مؤكد)', FAILED: 'فشل',
  UNKNOWN: 'غير مؤكد — بانتظار المطابقة', REJECTED: 'مرفوض',
};
