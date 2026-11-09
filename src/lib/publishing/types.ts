import type { MediaFormat, SocialPlatform } from '@prisma/client';

export interface PublishRequest {
  idempotencyKey: string;
  providerBrandId: string; // Metricool blogId
  network: SocialPlatform;
  format: MediaFormat;
  publishAt: Date; timezone: string;
  text: string;
  mediaUrls: string[];
  thumbnailUrl?: string;
  title?: string; // YouTube / Pinterest
  aiGenerated: boolean;
}

export type SubmitOutcome =
  | { kind: 'ACCEPTED'; providerPostId: string; providerStatus: string; raw: unknown; httpStatus: number }
  | { kind: 'REJECTED'; httpStatus: number; message: string; raw?: unknown } // definitive: not created
  | { kind: 'RATE_LIMITED'; retryAfterSec: number; httpStatus: number; message: string } // definitive: not created
  | { kind: 'UNCERTAIN'; message: string; httpStatus?: number }; // may or may not exist → reconcile

export type RemoteStatus =
  | { kind: 'PUBLISHED'; providerPostId: string; publicUrl?: string; raw: unknown }
  | { kind: 'PENDING'; providerPostId: string; raw: unknown }
  | { kind: 'ERROR'; providerPostId: string; message: string; raw: unknown }
  | { kind: 'NOT_FOUND' };

export interface ProviderProfile { brandId: string; label: string; timezone?: string; networks: { network: SocialPlatform; handle?: string; id?: string }[]; raw?: unknown }

export interface PublishingAdapter {
  readonly name: string;
  verify(): Promise<{ ok: boolean; message: string }>;
  listProfiles(): Promise<ProviderProfile[]>;
  submit(req: PublishRequest): Promise<SubmitOutcome>;
  getStatus(brandId: string, providerPostId: string, around: Date, timezone: string): Promise<RemoteStatus>;
  /** Find a post we may have created (used when the submit result was UNCERTAIN). */
  findExisting(req: PublishRequest): Promise<{ providerPostId: string; raw: unknown } | null>;
}
