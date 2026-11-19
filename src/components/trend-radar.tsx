'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/client/api';
import type { TrendIdea, TrendRadar } from '@/lib/growth/trends';
import { Badge, Button } from './ui';
import { toast } from './toaster';

const GEO_AR: Record<string, string> = { BH: 'البحرين', SA: 'السعودية', AE: 'الإمارات', KW: 'الكويت', QA: 'قطر', OM: 'عُمان' };
const FORMAT_AR: Record<string, string> = { REEL_VIDEO: 'ريل', IMAGE_CAROUSEL: 'كاروسيل', IMAGE_FEED: 'منشور', IMAGE_SQUARE: 'مربع', IMAGE_STORY: 'ستوري' };
const STATUS: Record<string, { tone: 'slate' | 'green' | 'blue' | 'red'; ar: string }> = { NEW: { tone: 'slate', ar: 'بانتظارك' }, APPROVED: { tone: 'green', ar: 'معتمدة' }, USED: { tone: 'blue', ar: 'صُمّمت' }, REJECTED: { tone: 'red', ar: 'مرفوضة/انتهت' } };
type Settings = { enabled: boolean; geos: string[]; ideasPerDay: number };

export function TrendRadarView({ radar, ideas, settings, canCreate, canControl }: { radar: TrendRadar | null; ideas: TrendIdea[]; settings: Settings; canCreate: boolean; canControl: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [cfg, setCfg] = useState(settings);
  const run = async (k: string, fn: () => Promise<{ message?: string }>, ok: string) => {
    setBusy(k);
    try { const r = await fn(); toast(r.message ?? ok); router.refresh(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };
  const save = (next: Settings) => { setCfg(next); void run('cfg', () => apiCall('/api/trends', { method: 'PUT', body: next }), 'حُفظ'); };
  const open = ideas.filter((i) => i.status === 'NEW' || i.status === 'APPROVED');
  const done = ideas.filter((i) => !(i.status === 'NEW' || i.status === 'APPROVED'));
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4 text-sm">
        <label className="flex items-center gap-2 font-bold">
          <input type="checkbox" disabled={!canControl || !!busy} checked={cfg.enabled} onChange={(e) => save({ ...cfg, enabled: e.target.checked })} />
          تشغيل يومي (٦:٢٠ صباحًا)
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {Object.entries(GEO_AR).map(([g, ar]) => (
            <label key={g} className="flex items-center gap-1 text-xs">
              <input type="checkbox" disabled={!canControl || !!busy || (cfg.geos.length === 1 && cfg.geos.includes(g))} checked={cfg.geos.includes(g)} onChange={(e) => save({ ...cfg, geos: e.target.checked ? [...cfg.geos, g] : cfg.geos.filter((x) => x !== g) })} />{ar}
            </label>
          ))}
        </div>
        {canCreate && <Button size="sm" variant="gold" className="ms-auto" disabled={!!busy} onClick={() => run('run', () => apiCall('/api/trends', { body: {} }), 'تم')}>{busy === 'run' ? '…' : 'حدّث الآن'}</Button>}
        <p className="w-full text-[11px] text-slate-500">التكلفة: استدعاء نصي صغير واحد يوميًا عند وجود مفتاح ذكاء اصطناعي (بدونه يعرض الترند فقط). لا شيء يُنشر تلقائيًا — الأفكار تنتظر اعتمادك في «بنك الأفكار» وتنتهي بعد ٣ أيام لأن الترند يبرد بسرعة. «دماغ الحساب» يتعلم لاحقًا هل منشورات الترند تنجح في كل حساب.</p>
      </div>

      {!radar && <div className="card p-4 text-sm text-slate-600">لم يُشغَّل الرادار بعد — اضغط «حدّث الآن».</div>}
      {radar?.error && <div className="card border-amber-300 bg-amber-50 p-3 text-xs">⚠️ {radar.error}</div>}

      {open.length > 0 && (
        <div className="card p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <b>أفكار من ترند اليوم ({open.length})</b>
            <a href="/ideas" className="text-xs font-bold text-navy-700 underline">فتح بنك الأفكار</a>
          </div>
          <ul className="space-y-2">{open.map((i) => (
            <li key={i.id} className="rounded-lg border border-orange-200 bg-orange-50/50 p-2.5 text-sm">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Badge tone="gold">🔥 {i.trend}</Badge> <b>{i.title}</b> {i.format && <Badge tone="blue">{FORMAT_AR[i.format] ?? i.format}</Badge>} <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].ar}</Badge>
                  <span className="block">{i.idea}</span>
                  <span className="block text-xs text-slate-600">{i.account}{i.hook ? ` · الافتتاحية: «${i.hook}»` : ''}{i.score ? ` · تقييم ${i.score}/10` : ''}</span>
                </div>
                {canCreate && i.status === 'NEW' && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="success" disabled={!!busy} onClick={() => run(i.id, () => apiCall(`/api/ideas/${i.id}`, { method: 'PATCH', body: { status: 'APPROVED' } }), 'اعتُمدت — الجدول الآلي يصممها في موعدها')}>اعتمد</Button>
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run(i.id, () => apiCall(`/api/ideas/${i.id}`, { method: 'PATCH', body: { status: 'REJECTED' } }), 'رُفضت')}>ارفض</Button>
                  </div>
                )}
              </div>
            </li>
          ))}</ul>
        </div>
      )}

      {radar && (
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(radar.geos).map(([g, ts]) => (
            <div key={g} className="card p-4">
              <div className="mb-2 flex items-center justify-between"><b>الأكثر بحثًا في {GEO_AR[g] ?? g}</b><span className="text-[11px] text-slate-500">{new Date(radar.at).toLocaleString('en-GB', { timeZone: 'Asia/Bahrain', dateStyle: 'short', timeStyle: 'short' })}</span></div>
              {!ts.length && <p className="text-xs text-slate-500">لا شيء آمن اليوم.</p>}
              <ol className="space-y-1.5 text-sm">{ts.map((t, k) => (
                <li key={t.title} className="flex items-start gap-2">
                  <span className="w-5 text-xs tabular-nums text-slate-400">{k + 1}</span>
                  <span className="min-w-0 flex-1"><b>{t.title}</b>{t.news[0] && <span className="block truncate text-[11px] text-slate-500">{t.news[0]}</span>}</span>
                  {t.traffic && <span className="ltr text-[11px] font-bold tabular-nums text-orange-700">{t.traffic}</span>}
                </li>
              ))}</ol>
            </div>
          ))}
        </div>
      )}
      {radar && <p className="text-[11px] text-slate-500">استُبعد {radar.blocked} ترند حساس (وفيات، حوادث، سياسة، جرائم…). المصدر: Google Trends — بحث حقيقي وليس تفاعلًا مصطنعًا.</p>}

      {done.length > 0 && (
        <details className="card p-4 text-sm"><summary className="cursor-pointer font-bold">أفكار ترند سابقة ({done.length})</summary>
          <ul className="mt-2 space-y-1">{done.map((i) => <li key={i.id}><Badge tone={STATUS[i.status].tone}>{STATUS[i.status].ar}</Badge> {i.account}: {i.title} <span className="text-xs text-slate-500">({i.trend})</span></li>)}</ul>
        </details>
      )}
    </div>
  );
}
