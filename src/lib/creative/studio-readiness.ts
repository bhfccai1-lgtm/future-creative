/** The studio's slice of the AI settings (the form owns the full object and saves it). */
export type StudioValues = {
  ownerGuidance?: string; bannedPhrases?: string[]; useReferences?: boolean; styleRefImage?: boolean;
  styleReferenceKey?: string | null; styleReferenceBrief?: string;
  styleRefsByFormat?: Partial<Record<'vertical' | 'feed' | 'square' | 'carousel', { key: string | null; brief: string }>>;
  creativeConcepts?: boolean; shotRecipes?: boolean; photoFinish?: boolean; bestOf?: number;
  adScore?: { enabled: boolean; threshold: number; maxRedraws: number };
  aiFullTextRetries?: number; aiTextFallback?: 'review' | 'template'; featuresRow?: 'ai' | 'system' | 'off';
  captionMentions?: string[]; qualityByFormat: Record<string, '' | 'low' | 'medium' | 'high'>;
};
/** Studio readiness: what a professional set-up has switched on (each item says how to reach it). */
export function studioReadiness(v: StudioValues) {
  const refs = (['vertical', 'feed', 'square'] as const).filter((k) => v.styleRefsByFormat?.[k]?.key).length + (v.styleReferenceKey ? 1 : 0);
  const items = [
    { ok: refs >= 2, tip: 'ارفع تصميمًا مرجعيًا لصيغتين على الأقل' },
    { ok: (v.ownerGuidance ?? '').trim().length >= 20, tip: 'اكتب توجيهًا دائمًا واضحًا للمصمم' },
    { ok: v.creativeConcepts ?? true, tip: 'فعّل «فكرة بصرية مميزة»' },
    { ok: v.shotRecipes ?? true, tip: 'فعّل «تصوير احترافي حسب المنتج»' },
    { ok: v.photoFinish ?? true, tip: 'فعّل «تنقيح الاستوديو»' },
    { ok: (v.bestOf ?? 1) >= 2, tip: 'اجعل المخرج الفني يختار من صورتين' },
    { ok: (v.adScore?.enabled ?? true) && (v.adScore?.threshold ?? 95) >= 90, tip: 'فعّل مؤشر الجودة بمعيار 90 أو أكثر' },
    { ok: (v.aiFullTextRetries ?? 2) >= 1, tip: 'فعّل تصحيح الإملاء مرة على الأقل' },
  ];
  const done = items.filter((i) => i.ok).length;
  return { pct: Math.round((done / items.length) * 100), missing: items.filter((i) => !i.ok).map((i) => i.tip) };
}
