'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type N8n = { enabled: boolean; webhookUrl: string; events: string[]; allowInboundApprovals: boolean; allowInboundGeneration: boolean };

export function N8nForm({ n8n, events, secret, token, apiBase }: { n8n: N8n; events: Record<string, string>; secret: boolean; token: boolean; apiBase: string }) {
  const router = useRouter();
  const [v, setV] = useState<N8n>(n8n);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [shown, setShown] = useState<{ kind: string; value: string } | null>(null);
  const toggle = (e: string) => setV((x) => ({ ...x, events: x.events.includes(e) ? x.events.filter((y) => y !== e) : [...x.events, e] }));
  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setMsg(null);
        try { await apiCall('/api/settings/n8n', { method: 'PUT', body: v }); setMsg({ ok: true, t: 'تم الحفظ ✓' }); router.refresh(); }
        catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
      }}>
        <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> تفعيل تكامل n8n</label>
        <div>
          <label className="label">رابط Webhook في n8n (يستقبل الأحداث)</label>
          <input className="input ltr" placeholder="http://n8n:5678/webhook/future-creative" value={v.webhookUrl} onChange={(e) => setV({ ...v, webhookUrl: e.target.value.trim() })} />
          <p className="mt-1 text-xs text-slate-500">إذا كان n8n يعمل على نفس السيرفر (ملف docker-compose) استخدم العنوان الداخلي <span className="ltr">http://n8n:5678/webhook/…</span> — لا يمر عبر الإنترنت.</p>
        </div>
        <div>
          <div className="label">الأحداث المرسلة</div>
          <div className="grid gap-1 md:grid-cols-2">{Object.entries(events).filter(([k]) => k !== 'test.ping').map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.events.includes(k)} onChange={() => toggle(k)} />{label} <span className="ltr text-[11px] text-slate-400">{k}</span></label>
          ))}</div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.allowInboundGeneration} onChange={(e) => setV({ ...v, allowInboundGeneration: e.target.checked })} /> السماح لـ n8n بطلب تصاميم جديدة (تذهب لطابور الموافقات)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.allowInboundApprovals} onChange={(e) => setV({ ...v, allowInboundApprovals: e.target.checked })} /> السماح بالاعتماد/الرفض من n8n (مثل أزرار تيليجرام) — نفس فحوص الجودة والبصمة</label>
        <div className="flex items-center gap-3"><Button>حفظ</Button>{msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</span>}</div>
      </form>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        {(['secret', 'token'] as const).map((kind) => (
          <Button key={kind} type="button" variant="outline" size="sm" onClick={async () => {
            if ((kind === 'secret' ? secret : token) && !confirm('سيُستبدل القديم وتتوقف الطلبات التي تستخدمه. متابعة؟')) return;
            try { const r = await apiCall<{ kind: string; value: string }>('/api/settings/n8n/rotate', { body: { kind } }); setShown(r); router.refresh(); }
            catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
          }}>{kind === 'secret' ? `${secret ? 'تجديد' : 'إنشاء'} سر توقيع الأحداث` : `${token ? 'تجديد' : 'إنشاء'} رمز API لـ n8n`}</Button>
        ))}
        <Button type="button" variant="gold" size="sm" onClick={async () => {
          try { const r = await apiCall<{ status: string; httpStatus: number | null; error: string | null }>('/api/settings/n8n/test', { body: {} }); setMsg({ ok: r.status === 'DELIVERED', t: r.status === 'DELIVERED' ? `وصل الاختبار إلى n8n ✓ (HTTP ${r.httpStatus})` : `لم يصل: ${r.error ?? r.httpStatus}` }); router.refresh(); }
          catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
        }}>إرسال حدث اختبار</Button>
      </div>
      {shown && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <b>{shown.kind === 'secret' ? 'سر التوقيع' : 'رمز API'} — انسخه الآن، لن يظهر مرة أخرى:</b>
          <code dir="ltr" className="mt-2 block break-all rounded bg-white p-2 text-left text-xs">{shown.value}</code>
          <p className="mt-1 text-xs text-slate-600">{shown.kind === 'secret' ? 'ضعه في n8n كمتغير FC_WEBHOOK_SECRET (للتحقق من توقيع X-FC-Signature).' : `ضعه في n8n كبيانات اعتماد Header Auth: الاسم Authorization والقيمة Bearer <الرمز>. عنوان الـAPI: ${apiBase}/api/integrations/n8n`}</p>
        </div>
      )}
    </div>
  );
}
