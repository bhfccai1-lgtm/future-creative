import { getSettings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateTextCost, recordUsage } from '../ai/cost';
import { AppError } from '../errors';
import { ContentSchema, PRESETS, type EduContent, type EduSection, type EduSettings } from './types';
import { arithmeticDrill, checkStatement } from './math';

/**
 * Educational content engine: lesson analysis → content → review. The AI writes; the system then checks what it can
 * check for certain (arithmetic) and fixes exercise answer keys by computation. Everything else is marked for a
 * teacher's review — the system never claims a curriculum source it was not given.
 */
const LANG = { ar: 'Arabic (Modern Standard Arabic, simple and child-friendly, correct grammar and spelling)', en: 'English (simple, age-appropriate)', bi: 'bilingual: Arabic first, then the English equivalent on the next line, for every heading and sentence' } as const;
const gradeNumber = (g: string) => { const m = g.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).match(/\d+/); if (m) return Number(m[0]); const w = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر']; const i = w.findIndex((x) => g.includes(x)); return i >= 0 ? i + 1 : 3; };
export const isMathSubject = (s: string) => /رياضيات|حساب|math/i.test(s);

export function contentPrompts(s: EduSettings) {
  const p = PRESETS[s.type];
  const need: string[] = [];
  if (p.engine === 'panels') need.push('6 panels: sections = exactly 3 inside sections (each with heading, short body, 2-4 bullets; put worked examples in the 2nd and exercises in the 3rd when the subject allows), plus intro, objectives, summary for the outer panels');
  if (p.engine === 'worksheet') need.push(`sections = 1-3 sections whose exercises total ${s.exerciseCount} items; each exercise: q (for arithmetic write it as «a + b = __»), answer (the correct answer), kind (equation | text | blank | choice), choices (only for choice)`);
  if (p.engine === 'poster') need.push(`sections = ${Math.max(3, s.columns * 2)} short sections (heading + 1-3 bullets or a 1-2 sentence body)`);
  if (p.engine === 'cards') need.push(`cards = ${s.cardCount} items: front = a word/term/question (very short), back = its meaning/answer`);
  if (p.engine === 'mindmap') need.push('mindmap = { center, branches: 4-7 branches with 1-3 short children each }');
  if (p.engine === 'table') need.push('table = { headers (2-5), rows (4-10) }');
  if (p.engine === 'certificate') need.push('certificate = { title, reason (one warm sentence about the achievement in this subject/lesson), date: "", signer: "" }');
  if (p.engine === 'cover') need.push('sections = [] — only title and subtitle');
  const system = [
    'You are an expert curriculum designer and teacher for schools in Bahrain and the Gulf. Write accurate, age-appropriate educational content.',
    `Language: ${LANG[s.lang]}. Grade: ${s.grade}. Subject: ${s.subject}. Detail level: ${s.detail}.`,
    'Rules: facts must be correct and uncontroversial; arithmetic must be exactly right (check every result); short sentences for young pupils;',
    'no invented textbook names, page numbers or claims that the content is from a specific official curriculum; no brand names, ads, phone numbers or websites;',
    'no names of real students; do not include images — only an optional short "image" description per section (what an illustration would show, no text in it).',
    'Return ONE JSON object: { title, subtitle, intro, objectives: string[] (3-5, specific and measurable), sections: [{ id, heading, body, bullets: string[], examples: [{ problem, steps: string[], answer }], exercises: [{ q, answer, kind, choices }], image }], summary: string[] (3-5 key points), activity?: { title, steps: string[] }, mindmap?, table?, cards?: [{front, back}], certificate? }.',
    `For this design (${p.en}): ${need.join('; ') || 'a balanced set of sections'}.`,
  ].join('\n');
  const user = JSON.stringify({ lesson: s.lesson, objectives_from_teacher: s.objectives || undefined, grade: s.grade, subject: s.subject });
  return { system, user };
}

/** Recomputes arithmetic answer keys; returns the corrections made (worked examples with wrong results are left for QC to FAIL). */
export function fixAnswerKeys(c: EduContent): string[] {
  const fixes: string[] = [];
  for (const sec of c.sections) for (const ex of sec.exercises) {
    const r = checkStatement(ex.q, ex.answer || '0');
    if (r && !r.ok) { fixes.push(`${ex.q}: ${ex.answer || '—'} → ${r.expected}`); ex.answer = String(r.expected); ex.kind = 'equation'; }
    else if (r) ex.kind = 'equation';
  }
  return fixes;
}

const uid = (i: number) => `s${i + 1}`;
export function normalizeContent(raw: unknown): EduContent {
  const parsed = ContentSchema.safeParse(raw);
  if (parsed.success) return { ...parsed.data, sections: parsed.data.sections.map((x, i) => ({ ...x, id: x.id || uid(i) })) };
  // tolerant fallback: keep what is usable instead of failing the whole lesson
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  return ContentSchema.parse({
    title: str(r.title, 140) || 'درس', subtitle: str(r.subtitle, 200), intro: str(r.intro, 800),
    objectives: arr(r.objectives).map((x) => str(x, 200)).filter(Boolean).slice(0, 8),
    sections: arr(r.sections).slice(0, 12).map((x, i) => { const o = (x ?? {}) as Record<string, unknown>; return {
      id: str(o.id, 40) || uid(i), heading: str(o.heading, 120), body: str(o.body, 1200),
      bullets: arr(o.bullets).map((b) => str(b, 240)).filter(Boolean).slice(0, 10),
      examples: arr(o.examples).slice(0, 4).map((e) => { const q = (e ?? {}) as Record<string, unknown>; return { problem: str(q.problem, 300), steps: arr(q.steps).map((t) => str(t, 240)).slice(0, 6), answer: str(q.answer, 120) }; }),
      exercises: arr(o.exercises).slice(0, 30).map((e) => { const q = (e ?? {}) as Record<string, unknown>; const k = str(q.kind, 10); return { q: str(q.q, 300), answer: str(q.answer, 120), kind: ['equation', 'text', 'blank', 'choice'].includes(k) ? k : 'text', choices: arr(q.choices).map((c) => str(c, 80)).slice(0, 4) }; }),
      image: str(o.image, 300) }; }),
    summary: arr(r.summary).map((x) => str(x, 240)).filter(Boolean).slice(0, 8),
    cards: arr(r.cards).slice(0, 24).map((c) => { const o = (c ?? {}) as Record<string, unknown>; return { front: str(o.front, 120), back: str(o.back, 240) }; }),
  });
}

/**
 * A clearly-labelled SAMPLE when no AI key is configured (dry-run): for arithmetic lessons it is complete and
 * computed; for other subjects it is a structure with «اكتب هنا…» placeholders for the teacher — never invented facts.
 */
export function sampleContent(s: EduSettings): EduContent {
  const ar = s.lang !== 'en';
  const g = gradeNumber(s.grade);
  if (isMathSubject(s.subject) && /جمع|طرح|add|subtract/i.test(s.lesson)) {
    const drill = arithmeticDrill(Math.max(4, s.exerciseCount), g, 7);
    return ContentSchema.parse({
      title: s.lesson, subtitle: ar ? `${s.subject} · ${s.grade}` : `${s.subject} · ${s.grade}`,
      intro: ar ? 'نجمع لنعرف الكل، ونطرح لنعرف الباقي. سنتعلّم الجمع والطرح خطوة بخطوة.' : 'We add to find the total and subtract to find what is left.',
      objectives: ar ? ['أجمع عددين بإعادة التجميع.', 'أطرح عددين مع الاستلاف.', 'أتحقق من الطرح باستخدام الجمع.'] : ['Add two numbers with regrouping.', 'Subtract with borrowing.', 'Check subtraction with addition.'],
      sections: [
        { id: 's1', heading: ar ? 'ما هو الجمع؟' : 'What is addition?', body: ar ? 'الجمع يعني ضمّ مجموعتين معًا لنعرف العدد الكلي.' : 'Addition puts groups together.', bullets: ar ? ['نرتّب الآحاد تحت الآحاد والعشرات تحت العشرات.', 'نبدأ الجمع من خانة الآحاد.'] : ['Line up ones and tens.', 'Start from the ones.'], examples: [], exercises: [] },
        { id: 's2', heading: ar ? 'أمثلة محلولة' : 'Worked examples', body: '', bullets: [], examples: [
          { problem: '27 + 15 = 42', steps: ar ? ['الآحاد: 7 + 5 = 12، نكتب 2 ونحمل 1', 'العشرات: 2 + 1 + 1 = 4'] : ['Ones: 7 + 5 = 12, write 2 carry 1', 'Tens: 2 + 1 + 1 = 4'], answer: '42' },
          { problem: '53 − 28 = 25', steps: ar ? ['نستلف من العشرات: 13 − 8 = 5', 'العشرات: 4 − 2 = 2'] : ['Borrow: 13 − 8 = 5', 'Tens: 4 − 2 = 2'], answer: '25' },
        ], exercises: [] },
        { id: 's3', heading: ar ? 'تدرّب' : 'Practice', body: '', bullets: [], examples: [], exercises: drill.map((d) => ({ q: d.q, answer: d.answer, kind: 'equation', choices: [] })) },
      ],
      summary: ar ? ['نجمع من الآحاد ثم العشرات.', 'نستلف عندما يكون الرقم العلوي أصغر.', 'الطرح عكس الجمع.'] : ['Add ones then tens.', 'Borrow when the top digit is smaller.', 'Subtraction undoes addition.'],
      activity: { title: ar ? 'نشاط: متجر الفصل' : 'Activity: class shop', steps: ar ? ['اختر سلعتين واجمع سعريهما.', 'اطرح المجموع من 100 لتعرف الباقي.'] : ['Pick two items and add their prices.', 'Subtract the total from 100.'] },
      cards: drill.slice(0, s.cardCount).map((d) => ({ front: d.q.replace('__', '؟'), back: d.answer })),
    });
  }
  const ph = ar ? 'اكتب هنا…' : 'Write here…';
  return ContentSchema.parse({
    title: s.lesson, subtitle: `${s.subject} · ${s.grade}`, intro: ph,
    objectives: (s.objectives ? s.objectives.split(/\n|،|,/) : [ph, ph]).map((x) => x.trim()).filter(Boolean).slice(0, 5),
    sections: Array.from({ length: PRESETS[s.type].engine === 'panels' ? 3 : 4 }, (_, i) => ({ id: uid(i), heading: `${ar ? 'الفقرة' : 'Part'} ${i + 1}`, body: ph, bullets: [], examples: [], exercises: [] })),
    summary: [ph], cards: Array.from({ length: s.cardCount }, () => ({ front: ph, back: '' })),
    certificate: { title: ar ? 'شهادة تقدير' : 'Certificate of Appreciation', reason: ph, date: '', signer: '' },
  });
}

export type GenResult = { content: EduContent; source: 'ai' | 'sample'; model?: string; fixes: string[] };

export async function generateContent(s: EduSettings): Promise<GenResult> {
  const settings = await getSettings();
  const provider = await getAiProvider(settings);
  if (provider.isDryRun || !provider.generateJson) { const content = sampleContent(s); return { content, source: 'sample', fixes: fixAnswerKeys(content) }; }
  await assertBudget(settings, estimateTextCost(settings, 2500, 3000));
  const { system, user } = contentPrompts(s);
  let r;
  try { r = await provider.generateJson(system, user, settings.ai.textModel); }
  catch (e) { throw new AppError('AI_FAILED', `تعذّر إنشاء المحتوى: ${(e as Error).message}`, 502); }
  await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(settings, r.usage.inputTokens, r.usage.outputTokens) });
  const content = normalizeContent(r.json);
  // arithmetic worksheets: the drill is computed by the system when the AI gave too few exercises
  if (isMathSubject(s.subject) && PRESETS[s.type].engine === 'worksheet') {
    const n = content.sections.reduce((a, x) => a + x.exercises.length, 0);
    if (n < s.exerciseCount && /جمع|طرح|add|subtract/i.test(s.lesson)) {
      const extra = arithmeticDrill(s.exerciseCount - n, gradeNumber(s.grade), 11).map((d) => ({ q: d.q, answer: d.answer, kind: 'equation' as const, choices: [] }));
      if (content.sections.length) content.sections[content.sections.length - 1].exercises.push(...extra);
      else content.sections.push({ id: 's1', heading: s.lang === 'en' ? 'Practice' : 'تدرّب', body: '', bullets: [], examples: [], image: '', exercises: extra });
    }
  }
  return { content, source: 'ai', model: r.model, fixes: fixAnswerKeys(content) };
}

/** Re-writes ONE section (the rest of the lesson is untouched). */
export async function regenerateSection(s: EduSettings, content: EduContent, sectionId: string): Promise<EduSection> {
  const settings = await getSettings();
  const provider = await getAiProvider(settings);
  const cur = content.sections.find((x) => x.id === sectionId);
  if (!cur) throw new AppError('NOT_FOUND', 'القسم غير موجود.', 404);
  if (provider.isDryRun || !provider.generateJson) throw new AppError('NO_AI', 'إعادة كتابة قسم تحتاج مفتاح OpenAI (وضع التجربة مفعّل) — عدّل النص يدويًا.', 412);
  await assertBudget(settings, estimateTextCost(settings, 1500, 900));
  const { system } = contentPrompts(s);
  const r = await provider.generateJson(system + '\nReturn ONE JSON object for a single section only: { id, heading, body, bullets, examples, exercises, image }. Make it clearly better and different from the current one, same topic and level.', JSON.stringify({ lesson: s.lesson, current_section: cur, other_headings: content.sections.filter((x) => x.id !== sectionId).map((x) => x.heading) }), settings.ai.textModel);
  await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(settings, r.usage.inputTokens, r.usage.outputTokens) });
  const sec = normalizeContent({ title: content.title, sections: [r.json] }).sections[0];
  if (!sec) throw new AppError('BAD_OUTPUT', 'لم يرجع النموذج قسمًا صالحًا.', 502);
  const tmp = { ...content, sections: [sec] }; fixAnswerKeys(tmp);
  return { ...tmp.sections[0], id: sectionId };
}
