'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiCall } from '@/lib/client/api';
import { Badge, Button } from './ui';
import { toast } from './toaster';

type Member = { id: string; email: string; name: string; role: string; active: boolean; locked: boolean; lastLoginAt: string | null; self: boolean };
type Role = { name: string; ar: string };
const input = 'w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm';
const ROLE_TONE: Record<string, 'navy' | 'blue' | 'slate'> = { ADMIN: 'navy', EDITOR: 'blue', VIEWER: 'slate' };

/** a strong random password (letters + digits, no look-alikes) for the admin to hand over in person */
function strongPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', dig = '23456789', all = abc + dig;
  const r = crypto.getRandomValues(new Uint32Array(16));
  const out = Array.from(r, (n) => all[n % all.length]);
  out[3] = dig[r[3] % dig.length]; out[9] = abc[r[9] % abc.length];
  return out.join('');
}
const fmt = (d: string | null) => d ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : 'لم يدخل بعد';

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <input className={`${input} ltr`} type="text" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} placeholder="12 حرفًا على الأقل، أحرف وأرقام" minLength={12} required />
      <Button type="button" variant="outline" size="sm" onClick={() => onChange(strongPassword())}>توليد</Button>
    </div>
  );
}

export function TeamUsers({ users, roles }: { users: Member[]; roles: Role[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ email: '', name: '', role: 'EDITOR', password: '' });
  const [reset, setReset] = useState<{ id: string; password: string } | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); router.refresh(); return true; } catch (e) { toast((e as Error).message, 'error'); return false; } finally { setBusy(null); }
  };
  const roleAr = (n: string) => roles.find((r) => r.name === n)?.ar ?? n;

  return (
    <div className="space-y-5">
      <ul className="divide-y divide-slate-100">
        {users.map((u) => (
          <li key={u.id} className={`py-3 ${u.active ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <b className="text-slate-900">{u.name}</b>{u.self && <Badge tone="gold">أنت</Badge>}
              <Badge tone={ROLE_TONE[u.role] ?? 'slate'}>{roleAr(u.role)}</Badge>
              {!u.active && <Badge tone="red">معطّل</Badge>}{u.locked && <Badge tone="amber">مقفل مؤقتًا</Badge>}
            </div>
            <div className="ltr mt-0.5 break-all text-right text-xs text-slate-500">{u.email}</div>
            <div className="text-xs text-slate-500">آخر دخول: {fmt(u.lastLoginAt)}</div>
            {!u.self && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs" value={u.role} disabled={busy === u.id}
                  onChange={(e) => run(u.id, () => apiCall(`/api/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'تم تغيير الدور — جلساته المفتوحة انتهت')}>
                  {roles.map((r) => <option key={r.name} value={r.name}>{r.ar}</option>)}
                </select>
                <Button size="sm" variant={u.active ? 'outline' : 'success'} disabled={busy === u.id}
                  onClick={() => (u.active ? confirm(`تعطيل ${u.name}؟ لن يستطيع الدخول وتنتهي جلساته.`) : true) && run(u.id, () => apiCall(`/api/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }), u.active ? 'تم التعطيل' : 'تم التفعيل')}>
                  {u.active ? 'تعطيل' : 'تفعيل'}
                </Button>
                {u.locked && <Button size="sm" variant="outline" disabled={busy === u.id} onClick={() => run(u.id, () => apiCall(`/api/users/${u.id}`, { method: 'PATCH', body: { unlock: true } }), 'تم فك القفل')}>فك القفل</Button>}
                <Button size="sm" variant="ghost" onClick={() => setReset(reset?.id === u.id ? null : { id: u.id, password: '' })}>كلمة مرور جديدة</Button>
              </div>
            )}
            {reset?.id === u.id && (
              <form className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3" onSubmit={async (e) => { e.preventDefault(); if (await run(u.id, () => apiCall(`/api/users/${u.id}/password`, { body: { password: reset.password } }), 'تم تعيين كلمة المرور — سلّمها له شخصيًا')) setReset(null); }}>
                <PasswordField value={reset.password} onChange={(password) => setReset({ id: u.id, password })} />
                <p className="text-xs text-slate-500">سلّمها له شخصيًا (لا ترسلها في مجموعة)، واطلب منه تغييرها من «كلمة المرور الخاصة بي» بعد أول دخول.</p>
                <Button size="sm" disabled={busy === u.id}>حفظ كلمة المرور</Button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <form className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={async (e) => { e.preventDefault(); if (await run('new', () => apiCall('/api/users', { body: form }), `تمت إضافة ${form.name}`)) setForm({ email: '', name: '', role: 'EDITOR', password: '' }); }}>
        <h3 className="font-bold text-navy-900">➕ إضافة عضو للفريق</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">الاسم<input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} /></label>
          <label className="text-sm">البريد الإلكتروني<input className={`${input} ltr`} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
          <label className="text-sm">الدور
            <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((r) => <option key={r.name} value={r.name}>{r.ar}</option>)}</select>
          </label>
          <div className="text-sm">كلمة المرور الأولى<PasswordField value={form.password} onChange={(password) => setForm({ ...form, password })} /></div>
        </div>
        <Button disabled={busy === 'new'}>إضافة</Button>
      </form>
    </div>
  );
}

export function ChangeMyPassword() {
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [busy, setBusy] = useState(false);
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (f.next !== f.again) { toast('كلمتا المرور الجديدتان غير متطابقتين', 'error'); return; }
      setBusy(true);
      try { await apiCall('/api/auth/password', { body: { current: f.current, next: f.next } }); toast('تم تغيير كلمة المرور — سجّل الدخول من جديد'); setTimeout(() => { location.href = '/login'; }, 900); }
      catch (err) { toast((err as Error).message, 'error'); } finally { setBusy(false); }
    }}>
      <label className="block text-sm">كلمة المرور الحالية<input className={`${input} ltr`} type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} required /></label>
      <label className="block text-sm">كلمة المرور الجديدة<input className={`${input} ltr`} type="password" autoComplete="new-password" minLength={12} value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} required /></label>
      <label className="block text-sm">تأكيد كلمة المرور الجديدة<input className={`${input} ltr`} type="password" autoComplete="new-password" minLength={12} value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} required /></label>
      <p className="text-xs text-slate-500">12 حرفًا على الأقل، أحرف وأرقام. بعد التغيير تنتهي كل جلساتك المفتوحة (على كل الأجهزة).</p>
      <Button disabled={busy}>تغيير كلمة المرور</Button>
    </form>
  );
}
