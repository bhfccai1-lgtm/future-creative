import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getSecret, getSettings } from '@/lib/settings';
import { pickDiverse, searchFreepik } from '@/lib/creative/inspiration';

/** «اختبار الاتصال»: one real search (free of AI cost) — returns how many diverse references it would use, with their links */
export const POST = api('settings:ai', async () => {
  const key = await getSecret('FREEPIK_API_KEY');
  if (!key) return NextResponse.json({ ok: false, message: 'لم يُحفظ مفتاح Freepik بعد.' });
  const s = await getSettings();
  try {
    const refs = pickDiverse(await searchFreepik(key, 'custom printed mug advertising product photography', { freeOnly: s.ai.inspiration.freeOnly }), s.ai.inspiration.count);
    return NextResponse.json({ ok: refs.length >= 3, message: refs.length >= 3 ? `الاتصال يعمل ✓ — ${refs.length} مراجع متنوعة لعبارة تجريبية` : `الاتصال يعمل لكن النتائج قليلة (${refs.length})`, sample: refs.slice(0, 5).map((r) => ({ title: r.title, url: r.url, license: r.license })) });
  } catch (e) { return NextResponse.json({ ok: false, message: (e as Error).message }); }
});
