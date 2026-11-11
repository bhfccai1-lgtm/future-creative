/**
 * Deterministic caption checks based on what worked / failed on the real accounts (Nov 2026 audit):
 * short hook visible before "more", short body, a clear CTA, ≤ 5 hashtags, light emoji use.
 * Advisory (QC WARNING) — it never blocks publishing.
 */
export function captionIssues(caption: string, opts: { cta: string; hashtags?: string[] }): string[] {
  const issues: string[] = [];
  const lines = caption.split('\n').map((l) => l.trim()).filter(Boolean);
  const hook = lines[0] ?? '';
  if (!hook) issues.push('لا يوجد سطر افتتاحي');
  else if ([...hook].length > 125) issues.push(`السطر الأول طويل (${[...hook].length} حرفًا) — يُقص قبل «المزيد»`);
  if (lines.length > 9) issues.push(`النص طويل (${lines.length} سطرًا) — النصوص الطويلة لم تجلب تعليقات`);
  if ([...caption].length > 900) issues.push(`النص ${[...caption].length} حرفًا — اختصره`);
  const ctaWord = opts.cta.trim().split(/\s+/)[0] ?? '';
  const hasCta = (ctaWord && caption.includes(ctaWord)) || /(راسلنا|أرسل|ارسل|الخاص|اطلب|تواصل|message|order|DM|send)/i.test(caption);
  if (!hasCta) issues.push('لا توجد دعوة واضحة لاتخاذ إجراء');
  const tags = opts.hashtags ?? caption.match(/#[^\s#]+/g) ?? [];
  if (tags.length > 5) issues.push(`${tags.length} وسمًا — إنستغرام يقبل 5 كحد أقصى`);
  const emojis = caption.match(/\p{Extended_Pictographic}/gu)?.length ?? 0;
  if (emojis > 8) issues.push(`${emojis} رمزًا تعبيريًا — قلّلها`);
  return issues;
}
