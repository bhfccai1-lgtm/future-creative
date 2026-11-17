import { notify } from '../audit';
import { loadInsights } from '../analytics/account-insights';
import { loadProgram, programProgress, saveProgram, weekOf, PHASES } from './program';

/** Weekly (and final) progress note to the owner while a growth program runs. Idempotent per week. */
export async function growthProgramReport(now = new Date()) {
  const p = await loadProgram();
  if (!p) return { skipped: 'NO_PROGRAM' };
  const w = weekOf(p, now);
  const week = w === 'done' ? 5 : w;
  if (week === 1 && now.getTime() - new Date(p.startedAt).getTime() < 6 * 86400_000) return { skipped: 'TOO_EARLY' };
  if (p.reports.some((r) => r.week === week)) return { skipped: 'ALREADY_SENT' };
  const prog = await programProgress(p, await loadInsights());
  const lines = p.accounts.map((a) => {
    const g = prog.find((x) => x.accountId === a.accountId)!;
    return `${a.name}: نُشر ${g.published}/${a.targets.contents}${g.followersNow != null && a.baseline.followers != null ? ` · متابعون ${a.baseline.followers}→${g.followersNow} (الهدف ${a.targets.followers})` : ''}${g.leads ? ` · استفسارات ${g.leads} · طلبات ${g.orders}` : ''}`;
  });
  const behind = p.accounts.filter((a) => { const g = prog.find((x) => x.accountId === a.accountId)!; return g.pctContent < (Math.min(4, week) / 4) * 60; }).map((a) => a.name);
  const head = w === 'done' ? 'انتهى برنامج النمو 30 يومًا — النتائج' : `برنامج النمو — بداية الأسبوع ${week}: ${PHASES[week - 1].title}`;
  const tail = w === 'done' ? 'راجع صفحة «برنامج النمو» وابدأ برنامج الشهر القادم.' : `تركيز الأسبوع: ${PHASES[week - 1].goal}${behind.length ? `\nمتأخرة في النشر: ${behind.join('، ')} — اعتمد تصاميمها من طابور الموافقات.` : ''}`;
  await notify(behind.length && w !== 'done' ? 'WARNING' : 'INFO', 'GROWTH_PROGRAM', head, `${lines.join('\n')}\n\n${tail}`.slice(0, 3000));
  await saveProgram({ ...p, reports: [...p.reports, { week, at: now.toISOString() }] });
  return { sent: week };
}
