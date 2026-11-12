'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Plan = { dryRun: boolean; total: number; changed: number; plan: { id: string; name: string; changes: string[] }[] };
export function CampaignUpgrade() {
  const router = useRouter();
  const [r, setR] = useState<Plan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (dryRun: boolean) => { setErr(null); try { const x = await apiCall<Plan>('/api/campaigns/upgrade', { body: { dryRun } }); setR(x); if (!dryRun) router.refresh(); } catch (e) { setErr((e as Error).message); } };
  return (
    <div className="space-y-2 text-sm">
      <p className="text-slate-600">الحملات القديمة أُنشئت قبل الميزات الجديدة (صامتة، قالب واحد، صيغة ثابتة). الترقية تجعلها: صوت حسب الإعدادات، طريقة تصميم تلقائية بأسلوب المطبعة، وتنويع ذكي للصيغ — مع الإبقاء على أي اختيار محدد قمت به.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => run(true)}>معاينة الترقية</Button>
        {r?.dryRun && r.changed > 0 && <Button type="button" size="sm" variant="gold" onClick={() => run(false)}>ترقية {r.changed} حملة</Button>}
      </div>
      {err && <p className="text-red-700">{err}</p>}
      {r && (r.changed === 0 ? <p className="text-emerald-700">كل الحملات محدثة ✓</p> : (
        <ul className="space-y-1 rounded-lg border bg-slate-50 p-2">{r.plan.map((p) => <li key={p.id}><b>{p.name}</b>: {p.changes.join('، ')}</li>)}{!r.dryRun && <li className="font-bold text-emerald-700">تمت الترقية ✓</li>}</ul>))}
    </div>
  );
}
