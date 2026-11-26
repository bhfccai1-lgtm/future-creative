/**
 * VOICE PERFORMANCE — how a voice director runs a commercial read:
 *  - EMOTION: the feeling the listener must hear (chosen by the owner, or from the occasion/product)
 *  - STYLE: the speaking style — it shapes how the copywriter writes the script AND how the voice delivers it
 *  - INTENSITY: how much of that feeling shows (subtle → expressive)
 *  - PER-LINE DIRECTION: the script writer marks each line with its own emotion, delivery and the words to stress;
 *    the voice model receives that as a performance map. The words themselves are verified unchanged — direction
 *    never edits the text.
 */

export interface Emotion { id: string; ar: string; icon: string; en: string }
export const EMOTIONS: Emotion[] = [
  { id: 'warm', ar: 'دفء', icon: '🤗', en: 'warm and sincere, like talking to someone you care about' },
  { id: 'joyful', ar: 'فرح', icon: '😄', en: 'joyful and bright, a genuine smile you can hear' },
  { id: 'proud', ar: 'فخر', icon: '🇧🇭', en: 'proud and uplifting, a festive spirit with dignity' },
  { id: 'tender', ar: 'حنان', icon: '💗', en: 'tender, loving and grateful, soft and from the heart' },
  { id: 'luxurious', ar: 'فخامة', icon: '✨', en: 'luxurious and refined, unhurried, velvety and elegant' },
  { id: 'energetic', ar: 'حماس', icon: '⚡', en: 'energetic and exciting, rising momentum, punchy' },
  { id: 'calm', ar: 'طمأنينة', icon: '🌿', en: 'calm and reassuring, soothing, every word gentle and clear' },
  { id: 'trust', ar: 'ثقة', icon: '🤝', en: 'confident and trustworthy, professional with friendly warmth' },
  { id: 'playful', ar: 'مرح', icon: '😜', en: 'playful and witty, light teasing timing, a grin in the voice' },
  { id: 'nostalgic', ar: 'حنين', icon: '🕰️', en: 'nostalgic and touching, like recalling a beautiful memory' },
  { id: 'inspiring', ar: 'إلهام', icon: '🌟', en: 'inspiring and hopeful, building to an uplifting finish' },
  { id: 'surprise', ar: 'دهشة', icon: '😮', en: 'amazed and delighted, a real "wow" moment of discovery' },
];

export interface SpeakStyle { id: string; ar: string; hint: string; write: string; deliver: string }
export const STYLES: SpeakStyle[] = [
  { id: 'conversational', ar: 'حديث صديق', hint: 'كأنك تنصح صديقًا — قريب وطبيعي',
    write: 'Write it as one friend recommending something to another: second person, everyday words, short natural phrases, no slogans.',
    deliver: 'Conversational and intimate, as if talking to one person a metre away; relaxed, natural hesitations are fine, never announcer-like.' },
  { id: 'storytelling', ar: 'حكاية قصيرة', hint: 'بداية ولحظة ونهاية سعيدة في ثوانٍ',
    write: 'Tell a 3-beat micro-story: a relatable moment, the turn where the product makes it special, the happy ending + call to action.',
    deliver: 'Storyteller delivery: draw the listener in, a small suspense pause before the turn, warmth at the happy ending.' },
  { id: 'announcer', ar: 'معلّق إعلانات', hint: 'صوت إعلان احترافي واثق',
    write: 'Classic premium commercial copy: a strong hook line, crisp benefit lines, a memorable sign-off with the call to action.',
    deliver: 'Polished commercial announcer: confident projection, crisp consonants, controlled energy, a short pause before the call to action.' },
  { id: 'testimonial', ar: 'تجربة شخصية', hint: '«جربت وانبهرت» — صادق وعفوي',
    write: 'First person, as a real customer sharing their own experience: what they wanted, how it turned out, a sincere recommendation. No exaggerated claims.',
    deliver: 'Authentic first-person testimonial: spontaneous, sincere, slightly informal, the delight sounds real and unscripted.' },
  { id: 'question_answer', ar: 'سؤال وجواب', hint: 'سؤال يشد ثم جواب يحل',
    write: 'Open with a question the viewer is already asking themselves, answer it with the product, then invite them to message us.',
    deliver: 'The question rises with real curiosity and a beat of silence after it; the answer lands warmly and with certainty.' },
  { id: 'whisper', ar: 'همس قريب', hint: 'قريب وهادئ كأنه سر جميل',
    write: 'Very short intimate phrases, as if sharing a lovely secret; soft words, nothing loud.',
    deliver: 'Close-mic, soft and breathy near-whisper, intimate and calm — still every word perfectly clear, never sleepy.' },
  { id: 'poetic', ar: 'سجع ونغم', hint: 'جمل موزونة بقافية خفيفة',
    write: 'Rhythmic lines with a light rhyme (saj‘) where it sounds natural in the dialect; balanced phrase lengths; elegant word choice.',
    deliver: 'Musical, rhythmic delivery that lets the rhyme ring; even cadence, a gentle lift at each line end.' },
  { id: 'reveal', ar: 'كشف مفاجأة', hint: 'تشويق ثم «تفضلوا!»',
    write: 'Build anticipation (what is it? wait for it…) and then reveal the product with delight; end with the call to action.',
    deliver: 'Rising anticipation with a held breath before the reveal, then a burst of genuine delight at the reveal.' },
  { id: 'news', ar: 'خبر سار', hint: 'إعلان خبر جميل بنبرة مذيع',
    write: 'Phrase it as happy news being announced: "good news for…", the news itself, how to get it.',
    deliver: 'Bright news-presenter delivery: clear, upbeat authority, crisp pacing, a friendly smile at the end.' },
];

export type Intensity = 'subtle' | 'natural' | 'expressive';
export const INTENSITY_AR: Record<Intensity, string> = { subtle: 'هادئ ومتحفظ', natural: 'طبيعي (موصى به)', expressive: 'معبّر وقوي' };
const INTENSITY_EN: Record<Intensity, string> = {
  subtle: 'Intensity: understated — the feeling is felt, not shown; minimal dynamics.',
  natural: 'Intensity: natural and believable, like a skilled actor in a real commercial.',
  expressive: 'Intensity: expressive and vivid — clear peaks of emotion and wide intonation, still believable, never shouting.',
};

export const emotionOf = (id?: string | null) => EMOTIONS.find((e) => e.id === id);
export const styleOf = (id?: string | null) => STYLES.find((s) => s.id === id);

/** «تلقائي»: the feeling from the occasion first (the strongest emotional cue), then the product category. */
export function autoEmotion(o: { category?: string | null; occasion?: string | null }): string {
  const oc = o.occasion ?? '', c = o.category ?? '';
  if (/national_day/.test(oc)) return 'proud';
  if (/ramadan|gergaoon|eid/.test(oc)) return 'warm';
  if (/mothers_day|women_day|fathers_day/.test(oc)) return 'tender';
  if (/wedding/.test(oc) || /أعراس|حفلات|زفاف/.test(c)) return 'joyful';
  if (/graduation|teachers_day|back_to_school/.test(oc) || /أطفال|مدارس|مدرس|تعليم/.test(c)) return 'inspiring';
  if (/diwali|onam|new_year|christmas/.test(oc)) return 'joyful';
  if (/فاخر|عطور|بخور|شموع/.test(c)) return 'luxurious';
  if (/هدايا|تذكار|هدية/.test(c)) return 'tender';
  if (/شركات|موظف|مكتب|عقار|معارض|مؤتمر/.test(c)) return 'trust';
  if (/مطاعم|مقاهي|محلات|ملصق|ستيكر/.test(c)) return 'energetic';
  return 'warm';
}

/** «تلقائي»: the style that suits the persona (a storyteller tells stories, a youth creator talks like a friend…). */
export function autoStyle(personaGroup: string | undefined, category = ''): string {
  if (personaGroup === 'story') return 'storytelling';
  if (personaGroup === 'youth' || personaGroup === 'comedy' || personaGroup === 'folk') return 'conversational';
  if (personaGroup === 'broadcast') return 'news';
  if (personaGroup === 'sports') return 'reveal';
  if (personaGroup === 'kids' || personaGroup === 'elder') return 'storytelling';
  if (/شركات|موظف|مكتب|عقار|معارض|مؤتمر/.test(category)) return 'announcer';
  if (/هدايا|تذكار/.test(category)) return 'storytelling';
  return 'announcer';
}

/** One directed line of the script: its own feeling, how to say it, the word(s) to stress, the pause after it. */
export interface PerfLine { text: string; emotion: string; delivery: string; stress: string[]; pause: 'none' | 'short' | 'long' }

const norm = (s: string) => s.replace(/[ً-ْٰ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Validates the writer's per-line direction against the final script: the lines must cover the script word for word
 * (in order, nothing added or dropped), emotions must be known, stress words must be in their line. Anything else →
 * null (the read falls back to the global emotion/style — the text is never changed by direction).
 */
export function checkPerformance(script: string, lines: unknown): PerfLine[] | null {
  if (!Array.isArray(lines) || !lines.length || lines.length > 12) return null;
  const out: PerfLine[] = [];
  for (const l of lines as Record<string, unknown>[]) {
    const text = String(l?.text ?? '').trim();
    if (!text) return null;
    const emotion = emotionOf(String(l?.emotion ?? '')) ? String(l.emotion) : 'warm';
    const stress = (Array.isArray(l?.stress) ? l.stress : []).map((w) => String(w).trim()).filter((w) => w && norm(text).includes(norm(w))).slice(0, 2);
    const pause = l?.pause === 'long' || l?.pause === 'none' ? l.pause : 'short';
    out.push({ text, emotion, delivery: String(l?.delivery ?? '').replace(/["«»]/g, '').slice(0, 120), stress, pause });
  }
  return norm(out.map((l) => l.text).join(' ')) === norm(script) ? out : null;
}

/** The performance map the voice model receives (one line per script line). */
export function performanceMap(lines: PerfLine[]): string {
  const pause = { none: '', short: ' Then a short breath.', long: ' Then a clear pause (about half a second).' } as const;
  return ['PERFORMANCE MAP — deliver each line exactly like this, in order:', ...lines.map((l, i) => {
    const e = emotionOf(l.emotion);
    return `${i + 1}) «${l.text}» — ${e ? e.en.split(',')[0] : l.emotion}${l.delivery ? `; ${l.delivery}` : ''}${l.stress.length ? `; stress «${l.stress.join('», «')}»` : ''}.${pause[l.pause]}`;
  })].join('\n');
}

/** Style + emotion + intensity as delivery instructions (used with or without a per-line map). */
export function directionInstructions(o: { emotion?: string; style?: string; intensity?: Intensity }): string {
  const e = emotionOf(o.emotion), s = styleOf(o.style);
  return [
    e ? `Overall emotion: ${e.en} — real feeling the listener can hear, never over-acted.` : '',
    s ? `Speaking style: ${s.deliver}` : '',
    INTENSITY_EN[o.intensity ?? 'natural'],
  ].filter(Boolean).join(' ');
}

/** What the script writer is asked to do for this emotion/style (merged into the voice-over request). */
export function writerDirection(o: { emotion?: string; style?: string }): { emotion?: string; style?: string } {
  const e = emotionOf(o.emotion), s = styleOf(o.style);
  return { ...(e ? { emotion: `${e.id}: ${e.en}` } : {}), ...(s ? { style: `${s.id}: ${s.write}` } : {}) };
}

/**
 * Breathing room: a run of more than `max` words with no punctuation is split with a comma at the most natural point
 * (before a conjunction/preposition when there is one). Commas only — no word is changed. Better rhythm for the voice,
 * shorter caption chunks for muted viewers.
 */
export function breathe(script: string, max = 6): string {
  const arabic = /[؀-ۿ]/.test(script), comma = arabic ? '،' : ',';
  const joiners = /^(و|ف|ثم|لكن|بس|عشان|حتى|مع|في|من|على|and|but|so|with|for|to|because)$/i;
  return script.split(/(?<=[،,.!?؟…:;])\s+/).map((chunk) => {
    const w = chunk.split(/\s+/);
    if (w.length <= max) return chunk;
    const out: string[] = [];
    let run = 0;
    for (let i = 0; i < w.length; i++) {
      out.push(w[i]); run++;
      const next = w[i + 1];
      const left = w.length - 1 - i;
      // break at `max` words, or a little earlier right before a joining word (a natural breath point)
      if (next && left >= 2 && !/[،,.!?؟…:;]$/.test(w[i]) && (run >= max || (run >= Math.max(3, max - 2) && joiners.test(next)))) { out[out.length - 1] += comma; run = 0; }
    }
    return out.join(' ');
  }).join(' ');
}
