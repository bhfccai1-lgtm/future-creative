import type { Campaign } from '@prisma/client';

/** Pure: what the upgrade changes for one campaign (explicit choices are kept). */
export function upgradePlan(c: Pick<Campaign, 'id' | 'name' | 'format' | 'direction'>) {
  const d = { ...((c.direction ?? {}) as Record<string, unknown>) };
  const changes: string[] = [];
  if (d.audio === 'none') { delete d.audio; changes.push('الصوت: صامت ← حسب الإعدادات (موسيقى/تعليق)'); }
  if (!d.renderMode) { d.renderMode = 'auto'; changes.push('طريقة التصميم ← تلقائي'); }
  if (!c.format && !d.autoFormat) { d.autoFormat = true; changes.push('الصيغة ← تنويع ذكي'); }
  if (d.reelStyle === 'standard' && !d.reelDuration) delete d.reelStyle;
  return { id: c.id, name: c.name, changes, direction: d };
}
