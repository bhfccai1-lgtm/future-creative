'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Profile = { brandId: string; label: string; timezone?: string; networks: { network: string; handle?: string; id?: string }[] };

export function IntegrationsForm({ m, token }: { m: { userId: string; baseUrl: string; requestsPerMinute: number }; token: { configured: boolean; last4: string | null } }) {
  const router = useRouter();
  const [v, setV] = useState(m);
  const [tok, setTok] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  return (
    <div className="space-y-5">
      <form className="grid gap-4 md:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault(); setMsg(null);
        try { await apiCall('/api/settings/integrations', { method: 'PUT', body: { ...v, token: tok || undefined } }); setTok(''); setMsg({ ok: true, t: 'تم الحفظ ✓' }); router.refresh(); }
        catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
      }}>
        <div><label className="label">Metricool API token (X-Mc-Auth)</label><input type="password" autoComplete="off" className="input ltr" placeholder={token.configured ? `مضبوط ••••${token.last4}` : ''} value={tok} onChange={(e) => setTok(e.target.value)} /></div>
        <div><label className="label">Metricool user ID</label><input className="input ltr" value={v.userId} onChange={(e) => setV({ ...v, userId: e.target.value })} /></div>
        <div><label className="label">Base URL</label><input className="input ltr" value={v.baseUrl} onChange={(e) => setV({ ...v, baseUrl: e.target.value })} /></div>
        <div><label className="label">حد الطلبات في الدقيقة</label><input type="number" min={1} className="input" value={v.requestsPerMinute} onChange={(e) => setV({ ...v, requestsPerMinute: Number(e.target.value) })} /></div>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button>حفظ</Button>
          <Button type="button" variant="outline" onClick={async () => { setMsg(null); try { const r = await apiCall<{ ok: boolean; message: string }>('/api/settings/integrations/verify', { method: 'POST' }); setMsg({ ok: r.ok, t: r.message }); router.refresh(); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } }}>اختبار الاتصال</Button>
          <Button type="button" variant="outline" onClick={async () => { setMsg(null); try { setProfiles(await apiCall<Profile[]>('/api/settings/integrations/profiles')); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } }}>جلب العلامات والشبكات المرتبطة</Button>
        </div>
      </form>
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'rounded bg-red-50 p-2 text-sm text-red-700'}>{msg.t}</p>}
      {profiles && (
        <table className="w-full"><thead><tr><th className="th">العلامة</th><th className="th">blogId</th><th className="th">الشبكات المرتبطة فعليًا (حسب Metricool)</th></tr></thead>
          <tbody>{profiles.map((p) => <tr key={p.brandId} className="border-t"><td className="td">{p.label}</td><td className="td ltr">{p.brandId}</td><td className="td text-xs ltr">{p.networks.map((n) => `${n.network}${n.handle ? ` (${n.handle})` : ''}`).join(', ') || '—'}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}
