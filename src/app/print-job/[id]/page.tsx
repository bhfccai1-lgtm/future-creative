import Link from 'next/link';
import { requirePageUser } from '@/lib/auth/server';
import { prisma } from '@/lib/db';
import { getBusiness } from '@/lib/business';
import { BriefSchema, type Analysis } from '@/lib/print/brief';
import { FINISHES, MATERIALS, METHODS } from '@/lib/print/catalog';
import { STAGES, STAGE_AR, type Production } from '@/lib/print/production';
import { PrintButton } from '@/components/print-button';
export const dynamic = 'force-dynamic';

const fmt = (d: string | Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bahrain', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));

/** JOB SHEET for the workshop: specs, files, approval, QA and production stages on one printable page */
export default async function PrintJobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser('ads:create');
  const { id } = await params;
  const p = await prisma.printProject.findUnique({ where: { id } });
  if (!p || (p.createdBy !== user.email && !user.perms.includes('users:manage'))) return <main className="p-6 text-center">غير موجود</main>;
  const a = p.analysis as unknown as Analysis; const b = BriefSchema.parse(p.brief);
  const biz = await getBusiness().catch(() => null);
  const files = ((p.exports as { files?: { kind: string; name: string; key: string; note?: string }[] } | null)?.files) ?? [];
  const thumbs = files.filter((f) => f.kind === 'jpg').slice(0, 4);
  const prod = p.production as Production | null;
  const decision = p.clientDecision as { status: string; name: string; at: string } | null;
  const qa = p.qa as { overall?: string; productionReady?: boolean } | null;
  const lead = p.leadId ? await prisma.lead.findUnique({ where: { id: p.leadId }, select: { name: true, contact: true, quoteNo: true } }) : null;
  const row = (k: string, v: React.ReactNode) => <tr className="border-b"><th className="w-40 bg-slate-50 p-1.5 text-right text-xs font-bold">{k}</th><td className="p-1.5 text-sm">{v}</td></tr>;
  return (
    <main dir="rtl" className="mx-auto max-w-3xl bg-white p-4 print:p-0">
      <div className="mb-3 flex items-center justify-between print:hidden"><Link href="/print-studio" className="text-sm font-bold">→ استوديو الطباعة</Link><PrintButton /></div>
      <header className="flex items-start justify-between border-b-2 border-slate-900 pb-2">
        <div><div className="text-xs text-slate-500">{biz?.nameAr ?? ''} — أمر شغل</div><h1 className="text-xl font-extrabold">{p.title}</h1></div>
        <div className="text-left text-xs" dir="ltr">#{p.id.slice(-8).toUpperCase()}<br />{fmt(new Date())}</div>
      </header>
      <table className="mt-3 w-full border text-right">
        <tbody>
          {row('المنتج', a.product.ar)}
          {row('المقاس النهائي', <span dir="ltr">{a.trim.w}×{a.trim.h} mm · bleed {a.bleedMm} mm · safe {a.safeMm} mm</span>)}
          {row(a.product.family === 'multipage' ? 'الصفحات' : 'الجهات', a.product.family === 'multipage' ? a.pages : a.sides === 2 ? 'وجهان' : 'وجه واحد')}
          {row('الكمية', b.quantity ?? '—')}
          {row('الخامة', a.material ? MATERIALS[a.material]?.ar ?? a.material : '—')}
          {row('طريقة الطباعة', a.method ? METHODS[a.method] ?? a.method : '—')}
          {row('التشطيبات', b.finishes.filter((f) => a.product.finishes.includes(f)).map((f) => FINISHES[f]?.ar ?? f).join('، ') || '—')}
          {row('الدقة المستهدفة', <span dir="ltr">{a.targetPpi} PPI</span>)}
          {row('العميل', lead ? `${lead.name ?? ''} ${lead.contact ?? ''}${lead.quoteNo ? ` · عرض سعر ${lead.quoteNo}` : ''}` : '—')}
          {row('الاعتماد', decision?.status === 'approved' ? `اعتمده العميل ${decision.name} — ${fmt(decision.at)}` : p.approvedAt ? `معتمد داخليًا — ${fmt(p.approvedAt)}` : 'غير معتمد ⚠')}
          {row('فحص الجودة', qa?.productionReady ? '✓ جاهز للإنتاج حسب الفحوص' : `${({ PASS: 'ناجح', NEEDS_REVISION: 'يحتاج تعديل', BLOCKED: 'موقوف', NOT_VERIFIED: 'غير متحقق' } as Record<string, string>)[qa?.overall ?? ''] ?? '—'} (راجع تقرير الجودة)`)}
        </tbody>
      </table>
      {a.warnings.length > 0 && <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs"><b>تنبيهات:</b> {a.warnings.join(' · ')}</div>}
      {thumbs.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2">{thumbs.map((f) => <img key={f.key} src={`/api/media/${f.key}`} alt={f.name} className="w-full border" />)}</div>}
      <h2 className="mt-4 text-sm font-extrabold">ملفات الإنتاج</h2>
      <ul className="mt-1 list-disc ps-5 text-xs">{files.filter((f) => f.kind !== 'jpg').map((f) => <li key={f.key}>{f.name}{f.note ? ` — ${f.note}` : ''}</li>)}{!files.length && <li>لم تُجهّز الملفات بعد</li>}</ul>
      <h2 className="mt-4 text-sm font-extrabold">مراحل الإنتاج</h2>
      <table className="mt-1 w-full border text-xs"><tbody>{STAGES.map((s) => { const h = [...(prod?.history ?? [])].reverse().find((x) => x.stage === s); return <tr key={s} className="border-b"><td className="w-8 p-1.5 text-center">{h ? '☑' : '☐'}</td><td className="p-1.5 font-bold">{STAGE_AR[s]}</td><td className="p-1.5" dir="ltr">{h ? `${fmt(h.at)} · ${h.by}` : ''}</td><td className="p-1.5">{h?.note ?? ''}</td></tr>; })}</tbody></table>
      <div className="mt-6 grid grid-cols-3 gap-4 text-center text-xs"><div className="border-t pt-1">الطباعة</div><div className="border-t pt-1">التشطيب</div><div className="border-t pt-1">التسليم</div></div>
    </main>
  );
}
