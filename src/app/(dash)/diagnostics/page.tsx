import { requirePageUser } from '@/lib/auth/server';
import { Card, PageHeader, Badge } from '@/components/ui';
import { runDiagnostics } from '@/lib/ops/diagnostics';
import { fmtLocal } from '@/lib/time';
export const dynamic = 'force-dynamic';

const TONE = { OK: 'green', WARN: 'amber', FAIL: 'red' } as const;
const AR = { OK: 'سليم', WARN: 'تنبيه', FAIL: 'خلل' } as const;

export default async function DiagnosticsPage() {
  await requirePageUser();
  const d = await runDiagnostics();
  return (
    <>
      <PageHeader title="تشخيص النظام" subtitle={`فحص مباشر للخدمات والحسابات والمهام — ${fmtLocal(new Date(d.at))} (البحرين). لا تُعرض قيم المفاتيح السرية إطلاقًا.`} actions={<Badge tone={TONE[d.overall]}>الحالة العامة: {AR[d.overall]}</Badge>} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px]"><thead><tr><th className="th">الفحص</th><th className="th">الحالة</th><th className="th">التفاصيل</th><th className="th">الإجراء المطلوب</th></tr></thead>
          <tbody>{d.checks.map((c) => <tr key={c.id} className="border-t"><td className="td font-bold">{c.label}</td><td className="td"><Badge tone={TONE[c.status]}>{AR[c.status]}</Badge></td><td className="td text-xs">{c.detail}</td><td className="td text-xs text-navy-700">{c.action ?? '—'}{c.command && <code dir="ltr" className="mt-1 block rounded bg-slate-100 px-2 py-1 text-left text-[11px]">{c.command}</code>}</td></tr>)}</tbody>
        </table>
      </Card>
    </>
  );
}
