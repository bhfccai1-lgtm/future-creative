'use client';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Cfg = { weekly: boolean; perAccount: number; useBank: boolean; autoApproveMinScore: number };
export function IdeasSettings({ initial }: { initial: Cfg }) {
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const save = async () => { setMsg(null); try { await apiCall('/api/settings/ideas', { method: 'PUT', body: v }); setMsg({ ok: true, t: 'تم الحفظ ✓' }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } };
  return (
    <div className="flex flex-wrap items-end gap-4 text-sm">
      <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={v.weekly} onChange={(e) => setV({ ...v, weekly: e.target.checked })} /> تعبئة البنك أسبوعيًا (السبت 7:40 صباحًا)</label>
      <div><label className="label">أفكار لكل حساب</label><input type="number" min={1} max={6} className="input" style={{ width: '5rem' }} value={v.perAccount} onChange={(e) => setV({ ...v, perAccount: Number(e.target.value) })} /></div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={v.useBank} onChange={(e) => setV({ ...v, useBank: e.target.checked })} /> النشر الآلي يستخدم الأفكار المعتمدة أولًا</label>
      <div><label className="label">اعتماد تلقائي للأفكار بتقييم ≥ (0 = أراجعها بنفسي)</label>
        <select className="input" style={{ width: '9rem' }} value={v.autoApproveMinScore} onChange={(e) => setV({ ...v, autoApproveMinScore: Number(e.target.value) })}>{[0, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n === 0 ? 'مراجعة يدوية' : `${n}/10 فأعلى`}</option>)}</select></div>
      <Button type="button" onClick={save}>حفظ</Button>
      {msg && <span className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</span>}
    </div>
  );
}
