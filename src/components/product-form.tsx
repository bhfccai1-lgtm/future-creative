'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

const lines = (s: FormDataEntryValue | null) => String(s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
const csv = (s: FormDataEntryValue | null) => String(s ?? '').split(/[,،]/).map((x) => x.trim()).filter(Boolean);

export function ProductForm({ categories }: { categories: { id: string; nameAr: string }[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  return (
    <form className="grid gap-3 md:grid-cols-3" onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      const f = new FormData(e.currentTarget);
      try {
        await apiCall('/api/products', { body: {
          slug: f.get('slug'), categoryId: f.get('categoryId'), name: f.get('titleEn'), titleAr: f.get('titleAr'), titleEn: f.get('titleEn'), titleMl: f.get('titleMl') || null,
          targetAudience: csv(f.get('audience')), occasions: csv(f.get('occasions')), visualGuidelines: f.get('visual'),
          recommendedMessages: { ar: lines(f.get('msgAr')), en: lines(f.get('msgEn')), ml: lines(f.get('msgMl')) }, relevantAccountTags: csv(f.get('tags')), active: true,
        } });
        (e.target as HTMLFormElement).reset(); setMsg({ ok: true, t: 'تمت الإضافة ✓' }); router.refresh();
      } catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
    }}>
      <div><label className="label">المعرّف (slug)</label><input name="slug" required pattern="[a-z0-9-]{3,60}" className="input ltr" placeholder="foam-board-printing" /></div>
      <div><label className="label">الفئة</label><select name="categoryId" required className="input">{categories.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}</select></div>
      <div><label className="label">الوسوم</label><input name="tags" className="input" placeholder="retail, events" /></div>
      <div><label className="label">العنوان العربي</label><input name="titleAr" required className="input" /></div>
      <div><label className="label">English title</label><input name="titleEn" required className="input ltr" /></div>
      <div><label className="label">Malayalam (اختياري)</label><input name="titleMl" className="input" /></div>
      <div><label className="label">الجمهور المستهدف (مفصول بفواصل)</label><input name="audience" className="input" /></div>
      <div><label className="label">المناسبات (مفصولة بفواصل)</label><input name="occasions" className="input" /></div>
      <div><label className="label">إرشادات بصرية (بالإنجليزية للنموذج)</label><input name="visual" required minLength={10} className="input ltr" /></div>
      <div><label className="label">رسائل معتمدة — عربي (سطر لكل رسالة)</label><textarea name="msgAr" rows={3} className="input" /></div>
      <div><label className="label">Approved messages — English</label><textarea name="msgEn" rows={3} className="input ltr" /></div>
      <div><label className="label">Malayalam</label><textarea name="msgMl" rows={3} className="input" /></div>
      <p className="text-xs text-amber-700 md:col-span-3">لا تُدخل أسعارًا أو عروضًا أو مدد تسليم أو قدرات غير مؤكدة — يرفضها فحص الجودة.</p>
      <div className="flex items-center gap-3 md:col-span-3"><Button>إضافة المنتج</Button>{msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</span>}</div>
    </form>
  );
}
