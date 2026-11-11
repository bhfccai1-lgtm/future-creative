import type { AdState, ConnectionStatus } from '@prisma/client';
import { Badge } from './ui';
import { STATE_LABEL_AR } from '@/lib/publishing/state-machine';

const TONE: Record<AdState, 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'gold' | 'navy'> = {
  DRAFT: 'slate', GENERATING: 'blue', GENERATED: 'blue', QUALITY_REVIEW: 'amber', APPROVED: 'gold', QUEUED: 'blue',
  SCHEDULED: 'navy', PUBLISHING: 'blue', PUBLISHED: 'green', FAILED: 'red', UNKNOWN: 'amber', REJECTED: 'slate',
};
export const StateBadge = ({ state }: { state: AdState }) => <Badge tone={TONE[state]}>{STATE_LABEL_AR[state]}</Badge>;

const CONN: Record<ConnectionStatus, [string, 'slate' | 'green' | 'red' | 'amber']> = {
  NOT_CONNECTED: ['غير مرتبط', 'slate'], PENDING_VERIFICATION: ['بانتظار التحقق', 'amber'], CONNECTED: ['مرتبط (مؤكد)', 'green'],
  EXPIRED: ['انتهت الصلاحية', 'red'], INSUFFICIENT_PERMISSIONS: ['صلاحيات غير كافية', 'red'], ERROR: ['خطأ', 'red'], DISCONNECTED: ['مفصول', 'slate'],
};
export const ConnBadge = ({ status }: { status?: ConnectionStatus | null }) => { const [l, t] = CONN[status ?? 'NOT_CONNECTED']; return <Badge tone={t}>{l}</Badge>; };

export const PLATFORM_AR: Record<string, string> = { instagram: 'إنستغرام', facebook: 'فيسبوك', tiktok: 'تيك توك', threads: 'ثريدز', youtube: 'يوتيوب', pinterest: 'بنترست', linkedin: 'لينكدإن', twitter: 'X', gmb: 'ملف Google التجاري' };
export const LANG_AR: Record<string, string> = { ar: 'العربية', en: 'English', ml: 'മലയാളം' };
export const FORMAT_AR: Record<string, string> = { IMAGE_STORY: 'صورة عمودية 1080×1920', IMAGE_FEED: 'صورة منشور 1080×1350', IMAGE_SQUARE: 'صورة مربعة 1080×1080', REEL_VIDEO: 'فيديو Reel متحرك', IMAGE_CAROUSEL: 'كاروسيل (شرائح)' };
