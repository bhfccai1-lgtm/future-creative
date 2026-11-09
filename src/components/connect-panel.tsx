'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type Profile = { brandId: string; label: string; networks: { network: string; handle?: string }[] };

/**
 * "Connect Account" via the provider (Metricool). Social passwords are never requested:
 * the social profile is authorised inside Metricool (official OAuth), then linked here by brand id.
 * The status becomes CONNECTED only if Metricool confirms the brand has this network linked.
 */
export function ConnectPanel({ accountId, platform, currentBrandId }: { accountId: string; platform: string; currentBrandId?: string | null }) {
  const router = useRouter();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [brandId, setBrandId] = useState(currentBrandId ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        اربط الحساب الاجتماعي أولًا داخل Metricool (تفويض رسمي OAuth — لا نطلب أو نخزن كلمات مرور الحسابات)، ثم اختر العلامة التجارية هنا. لن تظهر الحالة «مرتبط» إلا بعد تأكيد المزود.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          try { setProfiles(await apiCall<Profile[]>('/api/settings/integrations/profiles')); } catch (e) { setMsg({ ok: false, t: (e as Error).message }); }
          setBusy(false);
        }}>جلب العلامات من Metricool</Button>
        {profiles ? (
          <select className="input w-72" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">— اختر —</option>
            {profiles.map((p) => <option key={p.brandId} value={p.brandId}>{p.label} ({p.brandId}) — {p.networks.map((n) => n.network).join(', ') || 'بلا شبكات'}{p.networks.some((n) => n.network === platform) ? ' ✓' : ''}</option>)}
          </select>
        ) : (
          <input className="input ltr w-48" placeholder="Metricool blogId" value={brandId} onChange={(e) => setBrandId(e.target.value)} />
        )}
        <Button type="button" variant="success" disabled={!brandId || busy} onClick={async () => {
          setBusy(true); setMsg(null);
          try { await apiCall(`/api/accounts/${accountId}/connect`, { body: { provider: 'metricool', providerBrandId: brandId } }); setMsg({ ok: true, t: 'تم التحقق والربط ✓' }); router.refresh(); }
          catch (e) { setMsg({ ok: false, t: (e as Error).message }); router.refresh(); }
          setBusy(false);
        }}>ربط الحساب والتحقق</Button>
      </div>
      {msg && <p className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</p>}
    </div>
  );
}
