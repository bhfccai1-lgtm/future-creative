/**
 * Makes a model's brief fit our limits instead of failing the whole design over one long field.
 * - Text is shortened at a word boundary (never mid-word), Arabic diacritics/extra spaces cleaned.
 * - `cta` longer than allowed → the business's official CTA (the design always uses the official one anyway).
 * - Lists are capped (hashtags, slides).
 * Content rules (claims, phones, spelling…) are still enforced later by QC — this only fixes length/shape.
 */
export const BRIEF_LIMITS = { idea: 400, ideaKey: 120, audience: 200, occasion: 120, sceneDescription: 1500, headline: 60, badge: 24, supportingCopy: 110, cta: 30, caption: 1800, styleNotes: 400, hashtag: 40, hashtags: 12, slideTitle: 60, slideBody: 220, slides: 5 } as const;

export function fitText(s: unknown, max: number): string {
  const t = String(s ?? '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
  const chars = [...t];
  if (chars.length <= max) return t;
  const cut = chars.slice(0, max).join('');
  const sp = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'), cut.lastIndexOf('،'), cut.lastIndexOf(','));
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s،,.\-–—:]+$/u, '').trim();
}

/** Caption: drop whole trailing lines rather than cutting a sentence in half. */
function fitCaption(s: unknown, max: number) {
  const lines = String(s ?? '').trim().split('\n');
  let out = '';
  for (const l of lines) { const next = out ? `${out}\n${l}` : l; if ([...next].length > max) break; out = next; }
  return out || fitText(s, max);
}

export function normalizeBrief(raw: unknown, defaultCta: string): { brief: Record<string, unknown>; adjusted: string[] } {
  const b = { ...((raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>) };
  const adjusted: string[] = [];
  const L = BRIEF_LIMITS;
  for (const k of ['idea', 'ideaKey', 'audience', 'occasion', 'sceneDescription', 'headline', 'supportingCopy', 'styleNotes'] as const) {
    if (typeof b[k] === 'string' && [...(b[k] as string)].length > L[k]) { b[k] = fitText(b[k], L[k]); adjusted.push(k); }
  }
  if (typeof b.badge === 'string' && [...b.badge].length > L.badge) { b.badge = fitText(b.badge.split(/\s+/).slice(0, 2).join(' '), L.badge); adjusted.push('badge'); }
  if (typeof b.cta !== 'string' || !b.cta.trim() || [...b.cta].length > L.cta) { if (b.cta !== undefined) adjusted.push('cta'); b.cta = [...defaultCta].length <= L.cta ? defaultCta : fitText(defaultCta, L.cta); }
  if (typeof b.caption === 'string' && [...b.caption].length > L.caption) { b.caption = fitCaption(b.caption, L.caption); adjusted.push('caption'); }
  if (Array.isArray(b.hashtags)) {
    const tags = [...new Set((b.hashtags as unknown[]).map((h) => String(h ?? '').trim()).filter(Boolean))].map((h) => fitText(h.replace(/\s+/g, '_'), L.hashtag)).slice(0, L.hashtags);
    if (tags.length !== (b.hashtags as unknown[]).length) adjusted.push('hashtags');
    b.hashtags = tags;
  }
  if (Array.isArray(b.slides)) {
    b.slides = (b.slides as { title?: unknown; body?: unknown }[]).slice(0, L.slides).map((s) => ({ title: fitText(s?.title, L.slideTitle), body: fitText(s?.body, L.slideBody) }));
  }
  return { brief: b, adjusted };
}

const FIELD_AR: Record<string, string> = { headline: 'العنوان', badge: 'كلمة الشارة', supportingCopy: 'السطر الداعم', cta: 'عبارة الحث', caption: 'نص المنشور', hashtags: 'الوسوم', sceneDescription: 'وصف المشهد', idea: 'الفكرة', slides: 'الشرائح' };
/** Arabic, field-specific message for a schema problem that normalisation could not fix. */
export function briefIssueAr(issue: { path: (string | number)[]; message: string; code?: string }) {
  const f = String(issue.path[0] ?? '');
  return `حقل «${FIELD_AR[f] ?? f}» في رد الذكاء الاصطناعي غير صالح (${issue.code === 'invalid_type' ? 'مفقود أو بنوع خاطئ' : issue.message})`;
}
