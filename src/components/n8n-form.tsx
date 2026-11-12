'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from './ui';

type N8n = { enabled: boolean; webhookUrl: string; events: string[]; allowInboundApprovals: boolean; allowInboundGeneration: boolean; allowInboundControl: boolean; approvalReminderHours: number; telegramChatId: string; telegramAllowedUserIds: string; gdriveFolderId?: string; gsheetId?: string };

function n8nHint(err: string | null, http: number | null) {
  if (http === 404) return 'HTTP 404 — n8n يعمل لكن المسار خطأ أو القالب 01 غير منشور (Publish). صحّح الرابط أو أعد تشغيل bash scripts/n8n-setup.sh';
  if (err && /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|timeout/i.test(err)) return 'لا يمكن الوصول إلى n8n — الخدمة غير مُشغّلة على السيرفر. نفّذ في الكونسول: cd /opt/future-creative ثم bash scripts/n8n-setup.sh';
  return err ?? (http ? `HTTP ${http}` : 'خطأ غير معروف');
}

export function N8nForm({ n8n, events, secret, token, apiBase, telegram }: { n8n: N8n; events: Record<string, string>; secret: boolean; token: boolean; apiBase: string; telegram: boolean }) {
  const router = useRouter();
  const [v, setV] = useState<N8n>({ ...n8n, webhookUrl: n8n.webhookUrl || 'http://n8n:5678/webhook/future-creative' });
  const [tgToken, setTgToken] = useState('');
  const [found, setFound] = useState<{ chats: { id: string; name: string; type: string }[]; users: { id: string; name: string }[]; hint?: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [shown, setShown] = useState<{ kind: string; value: string } | null>(null);
  const toggle = (e: string) => setV((x) => ({ ...x, events: x.events.includes(e) ? x.events.filter((y) => y !== e) : [...x.events, e] }));
  return (
    <div className="space-y-4">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault(); setMsg(null);
        try {
          // a browser may autofill this password-type field with a saved password: only a real BotFather token is sent
          const tokenOk = /^\d{5,}:[\w-]{20,}$/.test(tgToken);
          await apiCall('/api/settings/n8n', { method: 'PUT', body: { ...v, telegramBotToken: tokenOk ? tgToken : undefined } });
          setTgToken('');
          setMsg({ ok: true, t: tgToken && !tokenOk ? 'تم الحفظ ✓ — وتجاهلنا قيمة غير صحيحة في «رمز البوت» (غالبًا ملأها المتصفح تلقائيًا)؛ الرمز المحفوظ باقٍ كما هو.' : 'تم الحفظ ✓' });
          router.refresh();
        }
        catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
      }}>
        <label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> تفعيل تكامل n8n</label>
        <div>
          <label className="label">رابط Webhook في n8n (يستقبل الأحداث)</label>
          <input className="input ltr" placeholder="http://n8n:5678/webhook/future-creative" value={v.webhookUrl} onChange={(e) => setV({ ...v, webhookUrl: e.target.value.trim() })} />
          {/^https?:\/\/n8n:5678\//.test(v.webhookUrl) && v.webhookUrl !== 'http://n8n:5678/webhook/future-creative' && (
            <p className="mt-1 text-xs text-red-700">المسار يجب أن يكون بالضبط <span className="ltr">http://n8n:5678/webhook/future-creative</span> — لا تُضف اسم البوت أو أي شيء بعده. <button type="button" className="underline" onClick={() => setV({ ...v, webhookUrl: 'http://n8n:5678/webhook/future-creative' })}>تصحيح</button></p>)}
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
        <fieldset className="rounded-lg border p-3">
          <legend className="px-1 text-sm font-bold">تيليجرام (للتنبيهات وأزرار الاعتماد)</legend>
          <ol className="mb-2 list-decimal pr-5 text-xs text-slate-600">
            <li>في تيليجرام افتح <b className="ltr">@BotFather</b> ← <span className="ltr">/newbot</span> ← انسخ الرمز والصقه هنا واحفظ.</li>
            <li>أرسل أي رسالة لبوتك الجديد (أو أضفه لمجموعة واكتب فيها).</li>
            <li>اضغط «اكتشاف تلقائي» — يملأ رقم المحادثة ورقمك.</li>
          </ol>
          <div className="grid gap-3 md:grid-cols-3">
            <div><label className="label">رمز البوت {telegram && <span className="text-emerald-700">(محفوظ ✓)</span>}</label><input type="password" name="fc-telegram-bot-token" autoComplete="new-password" data-lpignore="true" data-1p-ignore className="input ltr" placeholder={telegram ? 'اتركه فارغًا للإبقاء عليه' : '123456789:AA…'} value={tgToken} onChange={(e) => setTgToken(e.target.value.trim())} /></div>
            <div><label className="label">رقم المحادثة (Chat ID)</label><input className="input ltr" value={v.telegramChatId} onChange={(e) => setV({ ...v, telegramChatId: e.target.value.trim() })} /></div>
            <div><label className="label">المسموح لهم بالاعتماد (User IDs)</label><input className="input ltr" placeholder="111,222" value={v.telegramAllowedUserIds} onChange={(e) => setV({ ...v, telegramAllowedUserIds: e.target.value })} /></div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={!telegram} onClick={async () => {
              setMsg(null);
              try {
                const r = await apiCall<NonNullable<typeof found>>('/api/settings/n8n/telegram-detect', { body: {} }); setFound(r);
                if (r.chats[0]) setV((x) => ({ ...x, telegramChatId: r.chats[r.chats.length - 1].id, telegramAllowedUserIds: [...new Set([...x.telegramAllowedUserIds.split(',').map((t) => t.trim()).filter(Boolean), ...r.users.map((u) => u.id)])].join(',') }));
              } catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
            }}>اكتشاف تلقائي</Button>
            <Button type="button" size="sm" variant="outline" disabled={!telegram} onClick={async () => {
              setMsg(null);
              try { await apiCall('/api/settings/n8n/telegram-test', { body: {} }); setMsg({ ok: true, t: 'وصلت رسالة الاختبار المباشر إلى تيليجرام ✓ — إن لم تصل رسائل n8n بعدها، أعد تشغيل: bash scripts/n8n-setup.sh ليأخذ n8n الأرقام المحفوظة.' }); }
              catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
            }}>اختبار تيليجرام مباشر</Button>
            {!telegram && <span className="text-xs text-slate-500">احفظ رمز البوت أولًا.</span>}
            {found && <span className="text-xs text-slate-600">{found.hint ?? `محادثات: ${found.chats.map((c) => `${c.name || c.type} (${c.id})`).join('، ')} · مستخدمون: ${found.users.map((u) => `${u.name} (${u.id})`).join('، ')} — اضغط «حفظ»`}</span>}
          </div>
        </fieldset>
        <fieldset className="rounded-xl border p-3">
          <legend className="px-1 text-sm font-extrabold text-navy-800">Google Drive و Sheets (أرشيف المنشورات + جدول الأفكار)</legend>
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className="label">رابط مجلد الأرشيف في Drive</label><input className="input ltr" placeholder="https://drive.google.com/drive/folders/…" value={v.gdriveFolderId ?? ''} onChange={(e) => setV({ ...v, gdriveFolderId: e.target.value.trim() })} /></div>
            <div><label className="label">رابط جدول Google Sheets</label><input className="input ltr" placeholder="https://docs.google.com/spreadsheets/d/…" value={v.gsheetId ?? ''} onChange={(e) => setV({ ...v, gsheetId: e.target.value.trim() })} /></div>
          </div>
          <p className="mt-1 text-xs text-slate-500">الجدول يحتاج ورقتين: «published» (الأرشيف) و«ideas» (الأفكار). بعد الحفظ شغّل bash scripts/n8n-setup.sh مرة واحدة، ثم اربط حساب Google داخل محرر n8n.</p>
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.allowInboundControl} onChange={(e) => setV({ ...v, allowInboundControl: e.target.checked })} /> السماح بإيقاف/استئناف حساب من n8n (إيقاف طارئ من تيليجرام)</label>
        <div className="flex items-center gap-2 text-sm">تذكير بالتصاميم المنتظرة بعد <input type="number" min={0} max={72} className="input" style={{ width: '5rem' }} value={v.approvalReminderHours} onChange={(e) => setV({ ...v, approvalReminderHours: Number(e.target.value) })} /> ساعات (0 = إيقاف)</div>
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
        <Button type="button" variant="outline" size="sm" onClick={async () => {
          try { const r = await apiCall<{ requeued: number; delivered: number; failed: number }>('/api/settings/n8n/redeliver', { body: { allDead: true } }); setMsg({ ok: r.failed === 0, t: `أعيد إرسال ${r.requeued} حدث — وصل ${r.delivered}، فشل ${r.failed}` }); router.refresh(); }
          catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
        }}>إعادة إرسال الأحداث الفاشلة</Button>
        <Button type="button" variant="gold" size="sm" onClick={async () => {
          try { const r = await apiCall<{ status: string; httpStatus: number | null; error: string | null }>('/api/settings/n8n/test', { body: {} }); setMsg({ ok: r.status === 'DELIVERED', t: r.status === 'DELIVERED' ? `وصل الاختبار إلى n8n ✓ (HTTP ${r.httpStatus})` : `لم يصل: ${n8nHint(r.error, r.httpStatus)}` }); router.refresh(); }
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
