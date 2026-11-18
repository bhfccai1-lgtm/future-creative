'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from './ui';
import { toast } from './toaster';
import { apiCall } from '@/lib/client/api';

/** Deletes a design after confirmation, then leaves its page (or refreshes the list). */
export function DeleteAdButton({ adId, headline, after, size = 'md', block }: { adId: string; headline?: string | null; after?: string; size?: 'sm' | 'md' | 'lg'; block?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="danger" size={size} className={block ? 'w-full whitespace-nowrap px-2' : undefined} disabled={pending} onClick={() => {
      if (!window.confirm(`حذف التصميم${headline ? ` «${headline}»` : ''} نهائيًا؟\nتُحذف صوره والفيديو ومحاولات النشر الفاشلة. لا يمكن التراجع.`)) return;
      start(async () => {
        try { const r = await apiCall<{ message: string }>(`/api/ads/${adId}`, { method: 'DELETE' }); toast(r.message); if (after) router.push(after); else router.refresh(); }
        catch (e) { toast((e as Error).message, 'error'); }
      });
    }}>{pending ? '...' : '🗑️ حذف'}</Button>
  );
}
