/**
 * Ready-made choices for the «البيانات التعليمية» form.
 * 1) The OFFICIAL list for the current school year is entered by the school/shop from the student textbook's table of
 *    contents (settings → education.curriculum) — shown first, marked «من كتاب الطالب».
 * 2) Otherwise: GENERAL topics typical for the subject at that school stage. They are suggestions only and never
 *    presented as the Bahrain Ministry's official list (that list is not published in a verifiable machine-readable form).
 */
export const SUBJECTS = [
  { ar: 'اللغة العربية', en: 'Arabic' }, { ar: 'الرياضيات', en: 'Mathematics' }, { ar: 'العلوم', en: 'Science' },
  { ar: 'التربية الإسلامية', en: 'Islamic Studies' }, { ar: 'اللغة الإنجليزية', en: 'English' }, { ar: 'الاجتماعيات', en: 'Social Studies' },
  { ar: 'التربية للمواطنة', en: 'Citizenship' }, { ar: 'تقنية المعلومات', en: 'ICT' }, { ar: 'التصميم والتقنية', en: 'Design & Technology' },
  { ar: 'التربية الفنية', en: 'Art' }, { ar: 'التربية الأسرية', en: 'Home Economics' }, { ar: 'التربية الرياضية', en: 'Physical Education' },
] as const;

export const GRADES = ['رياض الأطفال', 'الصف الأول', 'الصف الثاني', 'الصف الثالث', 'الصف الرابع', 'الصف الخامس', 'الصف السادس', 'الصف السابع', 'الصف الثامن', 'الصف التاسع', 'الصف العاشر', 'الصف الحادي عشر', 'الصف الثاني عشر'] as const;
export const GRADES_EN = ['Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] as const;

export type Stage = 'kg' | 'lower' | 'upper' | 'intermediate' | 'secondary';
export const STAGE_AR: Record<Stage, string> = { kg: 'رياض الأطفال', lower: 'الحلقة الأولى (١–٣)', upper: 'الحلقة الثانية (٤–٦)', intermediate: 'الإعدادي (٧–٩)', secondary: 'الثانوي (١٠–١٢)' };
const AR_ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر'];
/** grade number 0 (KG) … 12 from any spelling («الصف الرابع», «Grade 4», «٤») or null */
export function gradeIndex(grade: string): number | null {
  const g = grade.trim(); if (!g) return null;
  if (/روضة|رياض|kg|kindergarten/i.test(g)) return 0;
  const d = g.replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).match(/\d+/);
  if (d) { const n = Number(d[0]); return n >= 1 && n <= 12 ? n : null; }
  // longest ordinal first («الحادي عشر» before «الحادي», «الثاني عشر» before «الثاني»)
  const order = AR_ORD.map((w, i) => ({ w, i })).sort((a, b) => b.w.length - a.w.length);
  const hit = order.find((x) => g.includes(x.w));
  return hit ? hit.i + 1 : null;
}
export function stageOf(grade: string): Stage | null {
  const n = gradeIndex(grade); if (n === null) return null;
  return n === 0 ? 'kg' : n <= 3 ? 'lower' : n <= 6 ? 'upper' : n <= 9 ? 'intermediate' : 'secondary';
}

type ByStage = Partial<Record<Stage, string[]>>;
const T: Record<string, ByStage> = {
  'اللغة العربية': {
    kg: ['الحروف الهجائية', 'أصوات الحروف', 'الألوان والأشكال', 'أسرتي', 'فصول السنة'],
    lower: ['الحروف الشمسية والقمرية', 'التنوين', 'المد بالألف والواو والياء', 'التاء المربوطة والمفتوحة', 'المفرد والمثنى والجمع', 'أدوات الاستفهام', 'الضمائر', 'علامات الترقيم'],
    upper: ['وطني', 'الجملة الاسمية والفعلية', 'الفعل الماضي والمضارع والأمر', 'همزة الوصل وهمزة القطع', 'كان وأخواتها', 'إن وأخواتها', 'الفاعل والمفعول به', 'كتابة الرسالة', 'الأسماء الخمسة'],
    intermediate: ['المبتدأ والخبر', 'الأفعال الخمسة', 'الممنوع من الصرف', 'الحال', 'التمييز', 'النعت والعطف', 'الهمزة المتوسطة', 'كتابة المقال'],
    secondary: ['البلاغة: التشبيه والاستعارة', 'العروض والبحور الشعرية', 'الأدب العباسي', 'النقد الأدبي', 'أسلوب الشرط', 'المشتقات', 'كتابة التقرير'],
  },
  'الرياضيات': {
    kg: ['الأعداد من 1 إلى 10', 'العد والمقارنة', 'الأشكال الهندسية', 'الأنماط', 'أكبر وأصغر'],
    lower: ['الجمع والطرح', 'القيمة المنزلية', 'جدول الضرب', 'القسمة', 'الوقت والساعة', 'النقود', 'الكسور البسيطة', 'القياس بالسنتيمتر'],
    upper: ['الكسور', 'الكسور العشرية', 'المحيط والمساحة', 'الزوايا', 'الأعداد الأولية والمضاعفات', 'النسبة المئوية', 'التمثيل البياني', 'الحجم'],
    intermediate: ['الأعداد الصحيحة', 'المعادلات الخطية', 'النسبة والتناسب', 'نظرية فيثاغورس', 'المساحة السطحية والحجم', 'الإحصاء والاحتمال', 'المتباينات', 'الدوال'],
    secondary: ['الدوال واللوغاريتمات', 'المتتاليات والمتسلسلات', 'حساب المثلثات', 'النهايات والاشتقاق', 'التكامل', 'المصفوفات', 'الإحصاء والاحتمالات'],
  },
  'العلوم': {
    kg: ['الحواس الخمس', 'الحيوانات وصغارها', 'النباتات', 'الطقس', 'الماء'],
    lower: ['أجزاء النبات', 'الحيوانات وبيئاتها', 'الحواس الخمس', 'حالات المادة', 'الطقس والفصول', 'الكائنات الحية وغير الحية', 'المغناطيس', 'الضوء والظل'],
    upper: ['دورة الماء في الطبيعة', 'السلسلة الغذائية', 'المجموعة الشمسية', 'جسم الإنسان', 'الدائرة الكهربائية', 'الصخور والمعادن', 'القوى والحركة', 'البيئة وحمايتها'],
    intermediate: ['الخلية', 'التكاثر في الكائنات الحية', 'الجدول الدوري', 'التفاعلات الكيميائية', 'الطاقة وتحولاتها', 'الضوء والصوت', 'الأرض والزلازل والبراكين', 'الوراثة'],
    secondary: ['الكيمياء العضوية', 'الأحماض والقواعد', 'قوانين نيوتن', 'الكهرباء والمغناطيسية', 'الوراثة الجزيئية', 'الأنظمة البيئية', 'الموجات'],
  },
  'التربية الإسلامية': {
    kg: ['أركان الإسلام', 'سورة الفاتحة', 'آداب الطعام', 'الوضوء', 'بر الوالدين'],
    lower: ['أركان الإسلام', 'أركان الإيمان', 'الوضوء', 'الصلاة', 'سورة الفاتحة', 'آداب الطعام', 'بر الوالدين', 'الصدق'],
    upper: ['أركان الإيمان', 'شروط الصلاة', 'الصيام', 'الزكاة', 'آداب المسجد', 'السيرة: الهجرة النبوية', 'سورة الكهف (قصص)', 'الأمانة'],
    intermediate: ['أحكام التجويد', 'الحج والعمرة', 'السيرة: غزوات الرسول ﷺ', 'الخلفاء الراشدون', 'آداب الحوار', 'حقوق الجار', 'الإحسان'],
    secondary: ['أصول الفقه', 'علوم القرآن', 'الحديث الشريف ومصطلحه', 'الأسرة في الإسلام', 'المعاملات المالية', 'الوسطية والاعتدال'],
  },
  'اللغة الإنجليزية': {
    kg: ['The alphabet', 'Colours', 'Numbers 1–10', 'Animals', 'My body'],
    lower: ['Phonics', 'My family', 'My school', 'Numbers 1–100', 'Days of the week', 'Fruits and vegetables', 'Animals', 'Clothes'],
    upper: ['Present simple', 'Present continuous', 'Past simple', 'Jobs', 'Weather and seasons', 'Daily routine', 'Comparatives', 'Writing a paragraph'],
    intermediate: ['Present perfect', 'Future forms', 'Passive voice', 'Conditionals', 'Reported speech', 'Writing an email', 'Reading comprehension'],
    secondary: ['Essay writing', 'Advanced grammar review', 'Literature: short stories', 'Presentation skills', 'Report writing', 'Vocabulary in context'],
  },
  'الاجتماعيات': {
    kg: ['وطني البحرين', 'علم البحرين', 'أسرتي', 'مدرستي'],
    lower: ['مملكة البحرين', 'العلم والنشيد الوطني', 'المهن', 'الأسرة والمجتمع', 'المحافظات', 'الخريطة والاتجاهات'],
    upper: ['معالم البحرين', 'محافظات البحرين', 'دول مجلس التعاون', 'اللؤلؤ في البحرين', 'التراث البحريني', 'المناخ والتضاريس', 'دلمون'],
    intermediate: ['الوطن العربي', 'الحضارات القديمة', 'الجغرافيا الطبيعية', 'الموارد الاقتصادية', 'السكان', 'تاريخ البحرين الحديث'],
    secondary: ['التاريخ الحديث والمعاصر', 'الجغرافيا البشرية', 'الاقتصاد', 'المنظمات الدولية', 'التنمية المستدامة'],
  },
  'التربية للمواطنة': {
    lower: ['حقوقي وواجباتي', 'النظافة العامة', 'قواعد المرور', 'التعاون', 'احترام الآخرين'],
    upper: ['المحافظة على البيئة', 'المسؤولية', 'التسامح', 'العمل التطوعي', 'مؤسسات الدولة'],
    intermediate: ['الدستور والميثاق', 'حقوق الإنسان', 'المشاركة المجتمعية', 'الحوار'],
    secondary: ['السلطات الثلاث', 'المواطنة الرقمية', 'الانتخابات', 'العلاقات الدولية'],
  },
  'تقنية المعلومات': {
    lower: ['أجزاء الحاسوب', 'لوحة المفاتيح والفأرة', 'الرسم بالحاسوب', 'الأمان على الإنترنت'],
    upper: ['الملفات والمجلدات', 'معالج النصوص', 'البرمجة بالصور (Scratch)', 'العروض التقديمية', 'المواطنة الرقمية'],
    intermediate: ['الجداول الإلكترونية', 'أساسيات البرمجة', 'الشبكات', 'قواعد البيانات', 'الأمن السيبراني'],
    secondary: ['البرمجة بلغة Python', 'الخوارزميات', 'تصميم المواقع', 'الذكاء الاصطناعي', 'قواعد البيانات المتقدمة'],
  },
  'التصميم والتقنية': { upper: ['الأدوات اليدوية', 'إعادة التدوير', 'مراحل التصميم', 'السلامة في المختبر'], intermediate: ['الرسم الفني', 'الإلكترونيات البسيطة', 'المواد وخصائصها', 'تصميم منتج'], secondary: ['التصميم بالحاسوب', 'الطباعة ثلاثية الأبعاد', 'الروبوتات'] },
  'التربية الفنية': { kg: ['الألوان', 'التلوين', 'الأشكال'], lower: ['الألوان الأساسية والثانوية', 'الخط والشكل', 'فن الكولاج', 'الطباعة باليد'], upper: ['الزخرفة الإسلامية', 'المنظور', 'الظل والنور', 'الخط العربي'], intermediate: ['تاريخ الفن', 'التصميم الجرافيكي', 'النحت'], secondary: ['الفن المعاصر', 'التصوير الفوتوغرافي', 'مشروع فني'] },
  'التربية الأسرية': { upper: ['الغذاء الصحي', 'النظافة الشخصية', 'ترتيب المنزل', 'الإسعافات الأولية'], intermediate: ['التغذية', 'إدارة الميزانية', 'الخياطة', 'سلامة الغذاء'], secondary: ['التخطيط للأسرة', 'الاستهلاك الرشيد', 'رعاية الطفل'] },
  'التربية الرياضية': { kg: ['الحركات الأساسية', 'الألعاب الجماعية'], lower: ['الإحماء', 'الجري والقفز', 'الألعاب الصغيرة'], upper: ['كرة القدم', 'كرة السلة', 'اللياقة البدنية'], intermediate: ['الكرة الطائرة', 'ألعاب القوى', 'التغذية والرياضة'], secondary: ['التدريب الرياضي', 'الإصابات الرياضية', 'القيادة الرياضية'] },
};

export const subjectKey = (subject: string) => { const s = subject.trim(); return SUBJECTS.find((x) => x.ar === s || x.en.toLowerCase() === s.toLowerCase() || (s.length > 2 && x.ar.includes(s)))?.ar ?? null; };

/** general topics for the subject at this stage (all stages merged when the grade is unknown) — suggestions only */
export function lessonIdeas(subject: string, grade = ''): string[] {
  const key = subjectKey(subject); if (!key) return [];
  const by = T[key] ?? {}; const st = stageOf(grade);
  if (st) return by[st] ?? [];
  return [...new Set(Object.values(by).flat())].slice(0, 12);
}

/** the official list entered for the current year (from the textbook's table of contents) */
export interface CurriculumEntry { subject: string; grade: number; lessons: string[]; source?: string }
export function officialLessons(entries: CurriculumEntry[], subject: string, grade: string): string[] {
  const key = subjectKey(subject), g = gradeIndex(grade);
  if (!key || g === null) return [];
  return entries.find((e) => e.subject === key && e.grade === g)?.lessons ?? [];
}

/**
 * Bulk import of the official lessons (all subjects and grades at once). Two accepted formats:
 *   1) headings:  «# الرياضيات | الصف الرابع» then one lesson per line (numbers / bullets are removed)
 *   2) CSV rows:  «المادة,الصف,الدرس» (comma, semicolon or tab separated; quotes allowed)
 * Unknown subjects or grades are reported, never guessed.
 */
export function parseCurriculumText(text: string): { entries: CurriculumEntry[]; errors: string[] } {
  const map = new Map<string, CurriculumEntry>(); const errors: string[] = [];
  const clean = (s: string) => s.replace(/^["'\s]+|["'\s]+$/g, '').replace(/^[\s\d٠-٩.\-–•)(*]+/, '').trim();
  const add = (subject: string, grade: string, lesson: string, line: number) => {
    const sk = subjectKey(subject), g = gradeIndex(grade), l = clean(lesson).slice(0, 160);
    if (!sk) { errors.push(`سطر ${line}: مادة غير معروفة «${subject.trim()}»`); return; }
    if (g === null) { errors.push(`سطر ${line}: صف غير معروف «${grade.trim()}»`); return; }
    if (!l) return;
    const k = `${sk}|${g}`; const e = map.get(k) ?? { subject: sk, grade: g, lessons: [] };
    if (!e.lessons.includes(l) && e.lessons.length < 80) e.lessons.push(l);
    map.set(k, e);
  };
  let cur: { subject: string; grade: string } | null = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim(); if (!line || line.startsWith('//')) return; // blank / comment
    const head = line.match(/^#+\s*(.+?)\s*[|،,\-–]\s*(.+)$/);
    if (head) { cur = { subject: head[1], grade: head[2] }; if (!subjectKey(head[1])) errors.push(`سطر ${i + 1}: مادة غير معروفة «${head[1]}»`); if (gradeIndex(head[2]) === null) errors.push(`سطر ${i + 1}: صف غير معروف «${head[2]}»`); return; }
    const cells = line.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.trim());
    // a CSV row is recognised by its grade column (so an unknown subject is reported, not swallowed as a lesson)
    if (cells.length >= 3 && (subjectKey(clean(cells[0])) || gradeIndex(clean(cells[1])) !== null)) { add(clean(cells[0]), clean(cells[1]), cells.slice(2).join(' - '), i + 1); return; }
    if (/^(المادة|subject)\b/i.test(line)) return; // CSV header
    if (cur) add(cur.subject, cur.grade, line, i + 1);
    else errors.push(`سطر ${i + 1}: لا يوجد عنوان «# المادة | الصف» قبل الدرس`);
  });
  return { entries: [...map.values()].filter((e) => e.lessons.length), errors: [...new Set(errors)].slice(0, 30) };
}
/** the reverse: the saved lists as an editable text file */
export function curriculumToText(entries: CurriculumEntry[], year: string): string {
  const order = (e: CurriculumEntry) => SUBJECTS.findIndex((s) => s.ar === e.subject) * 100 + e.grade;
  return [`// منهج ${year} — دروس كتاب الطالب`, '', ...[...entries].sort((a, b) => order(a) - order(b)).flatMap((e) => [`# ${e.subject} | ${GRADES[e.grade]}`, ...e.lessons, ''])].join('\n');
}
