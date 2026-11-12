'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Acc = { id: string; name: string; promoteToIds: string[] };
export function CrossPromoSettings({ cfg, accounts }: { cfg: { enabled: boolean; maxPerTargetPerDay: number; delayMinutes: number }; accounts: Acc[] }) {
  const router = useRouter();
  const [v, setV] = useState(cfg);
  const [links, setLinks] = useState<Record<string, string[]>>(Object.fromEntries(accounts.map((a) => [a.id, a.promoteToIds])));
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const name = (id: string) => accounts.find((a) => a.id === id)?.name ?? '؟';
  const save = async (suggest = false) => {
    setMsg(null);
    try { const r = await apiCall<{ links: Record<string, string[]> }>('/api/settings/cross-promo', { method: 'PUT', body: { ...v, links: suggest ? undefined : links, suggest } }); setLinks(r.links); setMsg({ ok: true, t: 'تم الحفظ ✓' }); router.refresh(); }
    catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
  };
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">عند نشر <b>منشور أو ريلز أو كاروسيل</b> مؤكد على حساب، تُنشأ <b>ستوري بهوية المطبعة</b> في الحسابات التي تختارها: «جديد على حسابنا @الحساب» مع صورة المنشور. ترويج شفاف من نفس العلامة — بلا تعليقات أو إعجابات مصطنعة. يمر بالموافقة/التفويض الذاتي، وفاصل 30 دقيقة، وحد يومي لكل حساب.</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 font-bold"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> تفعيل الترويج المتبادل</label>
        <div><label className="label">الحد اليومي لكل حساب</label><input type="number" min={1} max={6} className="input" style={{ width: '6rem' }} value={v.maxPerTargetPerDay} onChange={(e) => setV({ ...v, maxPerTargetPerDay: Number(e.target.value) })} /></div>
        <div><label className="label">بعد النشر بـ (دقيقة)</label><input type="number" min={0} max={720} className="input" style={{ width: '6rem' }} value={v.delayMinutes} onChange={(e) => setV({ ...v, delayMinutes: Number(e.target.value) })} /></div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px]"><thead><tr><th className="th">عندما ينشر</th><th className="th">يُشارك في ستوري</th></tr></thead>
          <tbody>{accounts.map((a) => (
            <tr key={a.id} className="border-t align-top"><td className="td font-bold">{a.name}</td>
              <td className="td"><div className="flex flex-wrap gap-1">{accounts.filter((x) => x.id !== a.id).map((x) => {
                const on = (links[a.id] ?? []).includes(x.id);
                return <button key={x.id} type="button" onClick={() => setLinks({ ...links, [a.id]: on ? links[a.id].filter((y) => y !== x.id) : [...(links[a.id] ?? []), x.id] })} className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-navy-800 bg-navy-800 text-white' : 'bg-white'}`}>{x.name}</button>;
              })}</div>{(links[a.id] ?? []).length > 0 && <div className="mt-1 text-xs text-slate-500">← {(links[a.id] ?? []).map(name).join('، ')}</div>}</td></tr>))}</tbody></table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => save(false)}>حفظ</Button>
        <Button type="button" variant="outline" onClick={() => save(true)}>تطبيق الربط المقترح (الحسابات المتخصصة ← الحسابات العامة)</Button>
        {msg && <span className={msg.ok ? 'text-emerald-700' : 'text-red-700'}>{msg.t}</span>}
      </div>
    </div>
  );
}
