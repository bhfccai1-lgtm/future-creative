/**
 * Sound design for reels, synthesised by FFmpeg (no samples, no licensing):
 *  - hit: a deep cinematic impact on the hook frame
 *  - whoosh: an airy swoosh into each scene transition
 *  - pop: a soft tick when a text line lands
 *  - chime: a bright two-note shimmer when the end card (logo + CTA) appears
 */
export type SfxKind = 'hit' | 'whoosh' | 'pop' | 'chime';
export interface SfxEvent { t: number; kind: SfxKind }

const R = 48000;
const esc = (x: string) => x.replace(/,/g, '\\,');
const LEN: Record<SfxKind, number> = { hit: 0.9, whoosh: 0.75, pop: 0.12, chime: 1.6 };

export function sfxSource(kind: SfxKind): string {
  const d = LEN[kind];
  switch (kind) {
    case 'hit': {
      const x = 'sin(2*PI*(42+110*exp(-26*t))*t)*exp(-5.5*t)*0.9+(random(0)*2-1)*exp(-40*t)*0.25';
      return `aevalsrc=${esc(`${x}|${x}`)}:s=${R}:d=${d},lowpass=f=4000`;
    }
    case 'whoosh':
      return `anoisesrc=d=${d}:c=pink:a=0.55:r=${R},bandpass=f=1100:width_type=o:w=2.2,afade=t=in:d=${(d * 0.65).toFixed(2)}:curve=exp,afade=t=out:st=${(d * 0.65).toFixed(2)}:d=${(d * 0.35).toFixed(2)},aformat=channel_layouts=stereo`;
    case 'pop': {
      const x = 'sin(2*PI*(900-500*t/0.12)*t)*exp(-45*t)*0.35';
      return `aevalsrc=${esc(`${x}|${x}`)}:s=${R}:d=${d}`;
    }
    case 'chime': {
      const x = '(sin(2*PI*1318.5*t)*exp(-3.2*t)+0.7*sin(2*PI*1975.5*max(0,t-0.12))*exp(-3.2*max(0,t-0.12))*gte(t,0.12)+0.25*sin(2*PI*2637*t)*exp(-6*t))*0.22';
      return `aevalsrc=${esc(`${x}|${x}`)}:s=${R}:d=${d},aecho=0.6:0.5:90:0.25`;
    }
  }
}

/** The events a reel gets: hook impact, a whoosh just before each transition, pops for text, chime at the end card. */
export function sfxTimeline(o: { hook: boolean; transitions: number[]; textAt: number[]; endAt: number; duration: number }): SfxEvent[] {
  const ev: SfxEvent[] = [];
  if (o.hook) ev.push({ t: 0, kind: 'hit' });
  for (const t of o.transitions) ev.push({ t: Math.max(0, t - 0.35), kind: 'whoosh' });
  for (const t of o.textAt.slice(0, 4)) if (t > 0.3) ev.push({ t, kind: 'pop' });
  if (o.endAt > 0 && o.endAt < o.duration - 0.5) ev.push({ t: o.endAt, kind: 'chime' });
  return ev.filter((e) => e.t < o.duration - 0.1).sort((a, b) => a.t - b.t);
}
