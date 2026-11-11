'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiCall } from '@/lib/client/api';
import { Button, Badge } from './ui';

type Audio = { voice: string; sfx: boolean; musicVolume: number; defaultReelAudio: string };
type Track = { id: string; name: string; mood: string; durationSec: number; startSec: number; licenseNote: string; active: boolean; uses: number };
const MOODS: [string, string][] = [['upbeat', 'حماسي'], ['calm', 'هادئ'], ['luxury', 'فاخر'], ['festive', 'احتفالي'], ['corporate', 'رسمي للشركات']];
const VOICES: [string, string][] = [['onyx', 'رجالي عميق'], ['ash', 'رجالي دافئ'], ['coral', 'نسائي دافئ'], ['nova', 'نسائي حيوي'], ['sage', 'هادئ ومتزن']];
const DEFAULTS: [string, string][] = [['none', 'بدون صوت'], ['upbeat', 'إيقاع حماسي (مولد)'], ['ambient', 'موسيقى هادئة (مولدة)'], ['library', 'من مكتبة موسيقاك المرخّصة'], ['voiceover', 'تعليق صوتي + موسيقى'], ['instagram', 'صوت من مكتبة إنستغرام']];

export function AudioSettings({ audio, tracks }: { audio: Audio; tracks: Track[] }) {
  const router = useRouter();
  const [v, setV] = useState(audio);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [up, setUp] = useState({ name: '', mood: 'upbeat', licenseNote: '', startSec: '0', confirm: false });
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-4">
        <div><label className="label">الصوت الافتراضي للريلز</label><select className="input" value={v.defaultReelAudio} onChange={(e) => setV({ ...v, defaultReelAudio: e.target.value })}>{DEFAULTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><label className="label">صوت المعلّق (OpenAI)</label><select className="input" value={v.voice} onChange={(e) => setV({ ...v, voice: e.target.value })}>{VOICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><p className="mt-1 text-xs text-slate-500">≈ $0.002 لكل ريلز — يقرأ العنوان والعبارة وزر الطلب فقط (بلا أرقام).</p></div>
        <div><label className="label">مستوى الموسيقى تحت التعليق</label><input type="range" min={0.1} max={1} step={0.05} className="w-full" value={v.musicVolume} onChange={(e) => setV({ ...v, musicVolume: Number(e.target.value) })} /><span className="text-xs text-slate-500">{Math.round(v.musicVolume * 100)}%</span></div>
        <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={v.sfx} onChange={(e) => setV({ ...v, sfx: e.target.checked })} /> مؤثرات صوتية (ضربة الافتتاح، انتقالات، رنين الخاتمة)</label>
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" onClick={async () => { try { await apiCall('/api/settings/audio', { method: 'PUT', body: v }); setMsg({ ok: true, t: 'تم الحفظ ✓' }); } catch (x) { setMsg({ ok: false, t: (x as Error).message }); } }}>حفظ</Button>
        {msg && <span className={msg.ok ? 'text-sm text-emerald-700' : 'text-sm text-red-700'}>{msg.t}</span>}
      </div>

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
