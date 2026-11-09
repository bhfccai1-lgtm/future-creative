'use client';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button } from '@/components/ui';

export default function LoginPage() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-950 via-navy-800 to-navy-950 p-4">
      <form className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        const f = new FormData(e.currentTarget);
        try { await apiCall('/api/auth/login', { body: { email: f.get('email'), password: f.get('password') } }); location.href = '/'; }
        catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>
        <div className="mb-6 text-center">
          <div className="text-2xl font-extrabold text-navy-900">مطبعة إبداع المستقبل</div>
          <div className="text-sm text-gold-600">نظام النشر الإعلاني الذكي</div>
        </div>
        <label className="label">البريد الإلكتروني</label>
        <input name="email" type="email" required autoComplete="username" className="input ltr mb-4" />
        <label className="label">كلمة المرور</label>
        <input name="password" type="password" required autoComplete="current-password" className="input ltr mb-6" />
        {err && <p className="mb-4 rounded bg-red-50 p-2 text-sm text-red-700">{err}</p>}
        <Button className="w-full" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'}</Button>
      </form>
    </main>
  );
}
