'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall, csrfToken } from '@/lib/client/api';
import { Button, Badge } from './ui';
import { LANG_GROUPS, PERSONA_GROUPS, PERSONAS, Q_AR, VOICE_LANGS } from '@/lib/audio/voices';
import { EMOTIONS, INTENSITY_AR, STYLES, emotionOf, styleOf, type Intensity } from '@/lib/audio/performance';

type Audio = { persona: string; voiceLang: string; sfx: boolean; musicVolume: number; defaultReelAudio: string; pace?: 'slow' | 'normal' | 'fast'; emotion?: string; style?: string; intensity?: Intensity; verifyPronunciation?: boolean; captions?: boolean; lexicon?: { from: string; to: string }[] };
const lexToText = (l?: { from: string; to: string }[]) => (l ?? []).map((e) => `${e.from} = ${e.to}`).join('\n');
const textToLex = (t: string) => t.split(/\r?\n/).map((l) => l.split(/\s*=\s*/)).filter((p) => p.length === 2 && p[0].trim() && p[1].trim()).map(([from, to]) => ({ from: from.trim(), to: to.trim() })).slice(0, 150);
type Track = { id: string; name: string; mood: string; durationSec: number; startSec: number; licenseNote: string; active: boolean; uses: number };
const MOODS: [string, string][] = [['upbeat', 'حماسي'], ['calm', 'هادئ'], ['luxury', 'فاخر'], ['festive', 'احتفالي'], ['corporate', 'رسمي للشركات']];
const DEFAULTS: [string, string][] = [['none', 'بدون صوت'], ['upbeat', 'إيقاع حماسي (مولد)'], ['ambient', 'موسيقى هادئة (مولدة)'], ['library', 'من مكتبة موسيقاك المرخّصة'], ['voiceover', 'تعليق صوتي + موسيقى'], ['instagram', 'صوت من مكتبة إنستغرام']];

export function AudioSettings({ audio, tracks, stumbles = [] }: { audio: Audio; tracks: Track[]; stumbles?: { word: string; count: number; suggestion: string | null }[] }) {
  const router = useRouter();
  const [v, setV] = useState(audio);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [up, setUp] = useState({ name: '', mood: 'upbeat', licenseNote: '', startSec: '0', confirm: false });
  const [busy, setBusy] = useState(false);
  const curLang = VOICE_LANGS.find((l) => l.id === v.voiceLang);
  const [group, setGroup] = useState(curLang?.group ?? 'arabic');
  type Dir = { emotion: string; style: string; intensity: Intensity; lines: { text: string; emotion: string; delivery: string; stress: string[] }[] };
  const [sample, setSample] = useState<{ url: string; script: string; accuracy: number | null; heard: string; missed: string; takes: number; dir: Dir | null } | null>(null);
  const [lexText, setLexText] = useState(lexToText(audio.lexicon));
  const [tryText, setTryText] = useState('');
  const [sampling, setSampling] = useState(false);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div><label className="label">الصوت الافتراضي للريلز</label><select className="input" value={v.defaultReelAudio} onChange={(e) => setV({ ...v, defaultReelAudio: e.target.value })}>{DEFAULTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label className="label">الجمهور (مجموعة اللغات)</label><select className="input" value={group} onChange={(e) => { setGroup(e.target.value); setV({ ...v, voiceLang: 'auto' }); }}>{Object.entries(LANG_GROUPS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label className="label">لغة / لهجة التعليق</label><select className="input" value={v.voiceLang} onChange={(e) => setV({ ...v, voiceLang: e.target.value })}>
          <option value="auto">تلقائي — حسب الجمهور (البحرينية افتراضيًا)</option>
          {VOICE_LANGS.filter((l) => l.group === group).map((l) => <option key={l.id} value={l.id}>{l.ar} — جودة {Q_AR[l.q]}</option>)}</select></div>
        <div><label className="label">الشخصية الصوتية</label><select className="input" value={v.persona} onChange={(e) => setV({ ...v, persona: e.target.value })}>
          <option value="auto">تلقائي — حسب فئة المنتج (تتنوع)</option>
          {Object.entries(PERSONA_GROUPS).map(([g, gl]) => <optgroup key={g} label={gl}>{PERSONAS.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.ar}</option>)}</optgroup>)}</select>
          <p className="mt-1 text-xs text-slate-500">≈ $0.003 لكل ريلز. النص يكتبه الذكاء الاصطناعي باللهجة المختارة من نص التصميم الموثّق — بلا أرقام أو أسعار أو وعود.</p></div>
        <div><label className="label">مستوى الموسيقى تحت التعليق</label><input type="range" min={0.1} max={1} step={0.05} className="w-full" value={v.musicVolume} onChange={(e) => setV({ ...v, musicVolume: Number(e.target.value) })} /><span className="text-xs text-slate-500">{Math.round(v.musicVolume * 100)}%</span></div>
        <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={v.sfx} onChange={(e) => setV({ ...v, sfx: e.target.checked })} /> مؤثرات صوتية (ضربة الافتتاح، انتقالات، رنين الخاتمة)</label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" onClick={async () => { try { await apiCall('/api/settings/audio', { method: 'PUT', body: { ...v, lexicon: textToLex(lexText) } }); setMsg({ ok: true, t: 'تم الحفظ ✓' }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } }}>حفظ</Button>
        <Button type="button" variant="outline" disabled={sampling} onClick={async () => {
          setSampling(true); setMsg(null);
          try {
            const r = await fetch('/api/settings/audio/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() }, body: JSON.stringify({ persona: v.persona, voiceLang: v.voiceLang, group, pace: v.pace ?? 'normal', emotion: v.emotion ?? 'auto', style: v.style ?? 'auto', intensity: v.intensity ?? 'natural', lexicon: textToLex(lexText), ...(tryText.trim() ? { text: tryText.trim() } : {}) }) });
            if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${r.status}`);
            const script = decodeURIComponent(r.headers.get('x-voice-script') ?? '');
            if (sample) URL.revokeObjectURL(sample.url);
            const acc = r.headers.get('x-voice-accuracy');
            setSample({ url: URL.createObjectURL(await r.blob()), script, accuracy: acc ? Number(acc) : null, heard: decodeURIComponent(r.headers.get('x-voice-heard') ?? ''), missed: decodeURIComponent(r.headers.get('x-voice-missed') ?? ''), takes: Number(r.headers.get('x-voice-takes') ?? 1), dir: (() => { try { return JSON.parse(decodeURIComponent(r.headers.get('x-voice-direction') ?? '')) as Dir; } catch { return null; } })() });
          } catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
          setSampling(false);
        }}>{sampling ? 'جارٍ التوليد والتحقق…' : tryText.trim() ? '🔊 استمع لجملتك' : '🔊 استماع لعينة'}</Button>
        {msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</span>}
      </div>
      {sample && (
        <div className="space-y-2 rounded-lg border bg-slate-50 p-3 text-sm">
          <audio controls autoPlay src={sample.url} className="w-full" />
          {sample.accuracy !== null && (
            <div className={`flex flex-wrap items-center gap-2 rounded-lg p-2 ${sample.accuracy >= 0.85 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
              <b className="text-lg">{Math.round(sample.accuracy * 100)}%</b><span>وضوح النطق (استمع النظام للصوت وقارنه بالنص)</span>
              {sample.takes > 1 && <span className="text-xs">· أُعيد التسجيل مرة بنطق أبطأ وأوضح</span>}
              {sample.missed && <span className="w-full text-xs">كلمات غير واضحة: <b>{sample.missed}</b> — أضفها للقاموس بنطق مشكّل.</span>}
            </div>
          )}
          <p className="text-xs text-slate-600"><b>ما قُرئ:</b> {sample.script}</p>
          {sample.heard && <p className="text-xs text-slate-500"><b>ما سُمع:</b> {sample.heard}</p>}
          {sample.dir && (
            <div className="rounded-lg border border-gold-300 bg-white p-2">
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                <b className="text-navy-900">🎬 أداء المخرج الصوتي:</b>
                <span className="rounded-full bg-gold-300/30 px-2 py-0.5 font-bold">{emotionOf(sample.dir.emotion)?.icon} {emotionOf(sample.dir.emotion)?.ar ?? sample.dir.emotion}</span>
                <span className="rounded-full bg-navy-800 px-2 py-0.5 font-bold text-white">{styleOf(sample.dir.style)?.ar ?? sample.dir.style}</span>
                <span className="text-slate-500">{INTENSITY_AR[sample.dir.intensity]}</span>
              </div>
              {sample.dir.lines.length > 0 && <ol className="space-y-1 text-xs">{sample.dir.lines.map((l, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-1.5"><span className="font-bold text-slate-400">{i + 1}</span>
                  <span title={emotionOf(l.emotion)?.ar}>{emotionOf(l.emotion)?.icon ?? '•'}</span>
                  <span className="font-bold text-navy-900" dir="auto">{l.text}</span>
                  {l.delivery && <span className="ltr text-[11px] text-slate-500" dir="ltr">— {l.delivery}</span>}
                  {l.stress.length > 0 && <span className="text-[11px] text-gold-600">نبرة على: {l.stress.join('، ')}</span>}</li>))}</ol>}
            </div>
          )}
        </div>
      )}

      <fieldset className="space-y-3 rounded-xl border-2 border-gold-300 bg-gradient-to-b from-gold-300/10 to-transparent p-3">
        <legend className="px-1 text-sm font-extrabold text-navy-800">🎭 المشاعر وأسلوب الكلام</legend>
        <p className="text-xs text-slate-600">مثل مخرج صوتي محترف: تختار الشعور الذي يصل للمستمع وأسلوب الحديث، ويكتب كاتب الإعلان النص بهذا الأسلوب ثم يوجّه أداء <b>كل جملة</b> (شعورها، نبرتها، الكلمة التي تُشدّ، والوقفة بعدها). الكلمات نفسها لا تتغير — الأداء فقط.</p>
        <div>
          <div className="label">الشعور</div>
          <div role="radiogroup" aria-label="الشعور" className="flex flex-wrap gap-1.5">
            {[{ id: 'auto', ar: 'تلقائي', icon: '🪄' }, ...EMOTIONS].map((e) => (
              <button key={e.id} type="button" role="radio" aria-checked={(v.emotion ?? 'auto') === e.id} onClick={() => setV({ ...v, emotion: e.id })}
                className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${(v.emotion ?? 'auto') === e.id ? 'border-gold-500 bg-gold-300/40 text-navy-900 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-gold-400'}`}>
                <span aria-hidden>{e.icon}</span> {e.ar}</button>))}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">«تلقائي»: من المناسبة أولًا (العيد الوطني فخر، يوم الأم حنان، رمضان دفء…) ثم فئة المنتج.</p>
        </div>
        <div>
          <div className="label">أسلوب الكلام</div>
          <div role="radiogroup" aria-label="أسلوب الكلام" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {[{ id: 'auto', ar: 'تلقائي', hint: 'حسب الشخصية الصوتية والمنتج' }, ...STYLES].map((st) => (
              <button key={st.id} type="button" role="radio" aria-checked={(v.style ?? 'auto') === st.id} onClick={() => setV({ ...v, style: st.id })}
                className={`rounded-xl border-2 p-2 text-right transition ${(v.style ?? 'auto') === st.id ? 'border-gold-500 bg-gold-300/20' : 'border-slate-200 bg-white hover:border-gold-300'}`}>
                <div className="text-sm font-extrabold text-navy-900">{st.ar}</div><div className="text-[11px] leading-4 text-slate-500">{st.hint}</div></button>))}
          </div>
        </div>
        <div>
          <div className="label">قوة التعبير</div>
          <div role="radiogroup" aria-label="قوة التعبير" className="inline-flex overflow-hidden rounded-lg border">
            {(Object.keys(INTENSITY_AR) as Intensity[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={(v.intensity ?? 'natural') === k} onClick={() => setV({ ...v, intensity: k })}
                className={`px-3 py-1.5 text-xs font-bold ${(v.intensity ?? 'natural') === k ? 'bg-navy-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{INTENSITY_AR[k]}</button>))}
          </div>
        </div>
        <p className="text-[11px] text-slate-500">اضغط «🔊 استماع لعينة» بالأعلى لتسمع الشعور والأسلوب قبل الحفظ — وتظهر لك خريطة الأداء لكل جملة.</p>
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border-2 border-gold-300 p-3">
        <legend className="px-1 text-sm font-extrabold text-navy-800">🗣️ النطق الصحيح</legend>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label">سرعة القراءة</label><select className="input" value={v.pace ?? 'normal'} onChange={(e) => setV({ ...v, pace: e.target.value as Audio['pace'] })}><option value="slow">هادئة وواضحة</option><option value="normal">طبيعية (إعلانية)</option><option value="fast">حيوية وسريعة</option></select></div>
          <label className="flex items-start gap-2 self-end pb-2 text-sm"><input type="checkbox" className="mt-1" checked={v.verifyPronunciation ?? true} onChange={(e) => setV({ ...v, verifyPronunciation: e.target.checked })} /><span><b>تحقق بالاستماع</b> — يستمع النظام لكل تعليق بعد توليده ويقارن الكلمات بالنص؛ إن لم تكن واضحة يُعيد التسجيل بنطق أبطأ وأوضح ويختار الأفضل (≈ $0.0005 لكل ريل).</span></label>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.captions ?? true} onChange={(e) => setV({ ...v, captions: e.target.checked })} /><span><b>ترجمة مكتوبة على الريلز</b> — يظهر التعليق الصوتي مكتوبًا بخط كبير متزامن مع الصوت (أغلب المشاهدين يشاهدون بلا صوت).</span></label>
        <div><label className="label" htmlFor="try-sentence">جرّب جملة بصوت الشخصية المختارة</label>
          <input id="try-sentence" className="input" maxLength={220} value={tryText} onChange={(e) => setTryText(e.target.value)} placeholder="مثال: أكواب مطبوعة بتصميمك من مطبعة إبداع المستقبل في سلماباد" />
          <p className="mt-1 text-xs text-slate-500">اكتب أي جملة ثم «استمع لجملتك» بالأعلى — يظهر لك ما قُرئ وما سُمع ونسبة الوضوح. الأرقام لا تُقرأ في الإعلانات.</p></div>
        <div><label className="label" htmlFor="lexicon">قاموس النطق — كلمة = طريقة نطقها (سطر لكل كلمة)</label>
          <textarea id="lexicon" rows={5} className="input font-mono text-sm leading-7" value={lexText} onChange={(e) => setLexText(e.target.value)} placeholder={'سلماباد = سَلْمَابَاد\nفلكس = فْلِكْس\nاسم منتجك = نطقه بالتشكيل'} />
          {stumbles.length > 0 && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs">
              <b>🎧 كلمات يتعثر فيها الصوت</b> <span className="text-slate-600">(من فحص الاستماع في الريلز — أضفها للقاموس ليُقرأ صحيحًا في المرة القادمة):</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{stumbles.map((m) => {
                const line = `${m.word} = ${m.suggestion ?? m.word}`;
                const added = lexText.split('\n').some((l) => l.split('=')[0]?.trim() === m.word);
                return <button key={m.word} type="button" disabled={added} title={m.suggestion ? `النطق المقترح: ${m.suggestion}` : 'أضفها ثم اكتب نطقها بالتشكيل'} className="rounded-full border border-amber-300 bg-white px-2 py-0.5 font-bold disabled:opacity-50"
                  onClick={() => setLexText((t) => (t.trim() ? `${t.trim()}\n${line}` : line))}>{added ? '✓ ' : '+ '}{m.word}{m.suggestion ? ` ← ${m.suggestion}` : ''} <span className="text-slate-500">×{m.count}</span></button>;
              })}</div>
            </div>
          )}
          <p className="mt-1 text-xs text-slate-500">مدمج مسبقًا: اسم المطبعة، سار، سلماباد، البحرين، ملصقات، رول أب، بنرات، واتساب، إنستغرام، تيشيرت، المحرق، المنامة، DTF، UV، PDF وغيرها. الأرقام تُنطق كلمات («٢٠٪» ← «عشرين بالمئة») وأرقام الهواتف لا تُقرأ. كلماتك هنا تتقدّم عليها. احفظ بعد التعديل.</p></div>
      </fieldset>

      <fieldset className="rounded-xl border p-3">
        <legend className="px-1 text-sm font-extrabold text-navy-800">مكتبة الموسيقى المرخّصة</legend>
        <p className="mb-2 text-xs text-slate-600">ارفع موسيقى تملك ترخيص استخدامها تجاريًا (مثل Pixabay Music أو YouTube Audio Library أو موسيقى مشتراة). يتنقّل النظام بينها حسب أسلوب التصميم ولا يكرر المقطع نفسه، ويضبط مستوى الصوت تلقائيًا (−14 LUFS). لا تستخدم أغاني تجارية بلا ترخيص — قد يُكتم الفيديو أو يُحذف.</p>
        <div className="grid gap-2 md:grid-cols-5">
          <input type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,.mp3,.m4a,.wav,.aac" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm md:col-span-2" />
          <input className="input" placeholder="الاسم (اختياري)" value={up.name} onChange={(e) => setUp({ ...up, name: e.target.value })} />
          <select className="input" value={up.mood} onChange={(e) => setUp({ ...up, mood: e.target.value })}>{MOODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input className="input" type="number" min={0} placeholder="يبدأ من الثانية" value={up.startSec} onChange={(e) => setUp({ ...up, startSec: e.target.value })} />
          <input className="input md:col-span-3" placeholder="مصدر الترخيص (مثال: Pixabay — رخصة Pixabay)" value={up.licenseNote} onChange={(e) => setUp({ ...up, licenseNote: e.target.value })} />
          <label className="flex items-center gap-2 text-xs md:col-span-2"><input type="checkbox" checked={up.confirm} onChange={(e) => setUp({ ...up, confirm: e.target.checked })} /> أؤكد أنني أملك ترخيص الاستخدام التجاري</label>
        </div>
        <Button type="button" size="sm" className="mt-2" disabled={busy || !file || !up.confirm || up.licenseNote.trim().length < 3} onClick={async () => {
          setBusy(true); setMsg(null);
          const fd = new FormData(); fd.set('file', file!); fd.set('name', up.name); fd.set('mood', up.mood); fd.set('licenseNote', up.licenseNote); fd.set('startSec', up.startSec); fd.set('confirm', '1');
          try { await apiCall('/api/settings/audio/tracks', { form: fd }); setMsg({ ok: true, t: 'أُضيف المقطع ✓' }); setFile(null); router.refresh(); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); }
          setBusy(false);
        }}>{busy ? 'جارٍ الرفع…' : 'رفع المقطع'}</Button>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm"><thead><tr><th className="th">المقطع</th><th className="th">الطابع</th><th className="th">المدة</th><th className="th">الترخيص</th><th className="th">الاستخدام</th><th className="th"></th></tr></thead>
            <tbody>{tracks.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="td font-bold">{t.name}</td>
                <td className="td">{MOODS.find(([k]) => k === t.mood)?.[1] ?? t.mood}</td>
                <td className="td ltr">{Math.round(t.durationSec)}s{t.startSec ? ` (من ${t.startSec}s)` : ''}</td>
                <td className="td text-xs">{t.licenseNote}</td>
                <td className="td">{t.uses}</td>
                <td className="td">{t.active
                  ? <Button size="sm" variant="ghost" type="button" onClick={async () => { await apiCall(`/api/settings/audio/tracks/${t.id}`, { method: 'PATCH', body: { active: false } }); router.refresh(); }}>إيقاف</Button>
                  : <span className="flex items-center gap-2"><Badge>متوقف</Badge><Button size="sm" variant="ghost" type="button" onClick={async () => { await apiCall(`/api/settings/audio/tracks/${t.id}`, { method: 'PATCH', body: { active: true } }); router.refresh(); }}>تفعيل</Button></span>}</td>
              </tr>))}
              {!tracks.length && <tr><td className="td text-xs text-slate-500" colSpan={6}>لا توجد مقاطع بعد — بدونها يستخدم النظام الموسيقى المولدة الخالية من الحقوق.</td></tr>}
            </tbody></table>
        </div>
      </fieldset>
    </div>
  );
}
