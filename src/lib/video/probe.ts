import { spawn } from 'node:child_process';

export interface VideoProbe {
  valid: boolean; problems: string[];
  container: string; codec: string; width: number; height: number; pixFmt: string; fps: number;
  durationSec: number; hasAudio: boolean; audioCodec?: string; audioRate?: number; colorSpace?: string; bitrateKbps?: number; bytes: number;
}

export function run(cmd: string, args: string[], timeoutMs = 300_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => { stderr += d; if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error(`${cmd} timed out after ${timeoutMs}ms`)); }, timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export interface VideoRequirements { width: number; height: number; minSec: number; maxSec: number; targetSec?: number; maxBytes: number }
/** Instagram Reels via Graph API: H.264, AAC, 9:16, 3–90s, ≤ 300 MB; we use a tighter default. */
export const REEL_REQUIREMENTS: VideoRequirements = { width: 1080, height: 1920, minSec: 3, maxSec: 90, maxBytes: 100 * 1024 * 1024 };

export async function probeVideo(file: string, req: VideoRequirements = REEL_REQUIREMENTS): Promise<VideoProbe> {
  const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
  const r = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], 60_000);
  if (r.code !== 0) return { valid: false, problems: [`ffprobe failed: ${r.stderr.slice(0, 300)}`], container: '', codec: '', width: 0, height: 0, pixFmt: '', fps: 0, durationSec: 0, hasAudio: false, bytes: 0 };
  const j = JSON.parse(r.stdout);
  const v = j.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
  const a = j.streams?.find((s: { codec_type: string }) => s.codec_type === 'audio');
  const [num, den] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  const out: VideoProbe = {
    valid: true, problems: [],
    container: j.format?.format_name ?? '', codec: v?.codec_name ?? '', width: v?.width ?? 0, height: v?.height ?? 0,
    pixFmt: v?.pix_fmt ?? '', fps: den ? num / den : 0, durationSec: Number(j.format?.duration ?? 0),
    hasAudio: !!a, audioCodec: a?.codec_name, audioRate: a?.sample_rate ? Number(a.sample_rate) : undefined, colorSpace: v?.color_space, bitrateKbps: j.format?.bit_rate ? Math.round(Number(j.format.bit_rate) / 1000) : undefined, bytes: Number(j.format?.size ?? 0),
  };
  const p = out.problems;
  if (!out.container.includes('mp4')) p.push(`container ${out.container} is not MP4`);
  if (out.codec !== 'h264') p.push(`video codec ${out.codec} (need h264)`);
  if (out.width !== req.width || out.height !== req.height) p.push(`dimensions ${out.width}x${out.height} (need ${req.width}x${req.height})`);
  if (out.pixFmt !== 'yuv420p') p.push(`pixel format ${out.pixFmt} (need yuv420p)`);
  if (out.fps < 23 || out.fps > 60) p.push(`frame rate ${out.fps.toFixed(2)} outside 23–60`);
  if (out.durationSec < req.minSec || out.durationSec > req.maxSec) p.push(`duration ${out.durationSec.toFixed(2)}s outside ${req.minSec}–${req.maxSec}s`);
  if (req.targetSec && Math.abs(out.durationSec - req.targetSec) > 1) p.push(`duration ${out.durationSec.toFixed(2)}s differs from target ${req.targetSec}s`);
  if (out.hasAudio && out.audioCodec !== 'aac') p.push(`audio codec ${out.audioCodec} (need aac)`);
  if (out.bytes > req.maxBytes) p.push(`file size ${(out.bytes / 1e6).toFixed(1)}MB too large`);
  out.valid = p.length === 0;
  return out;
}
