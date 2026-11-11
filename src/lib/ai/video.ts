import { getSecret, type Settings } from '../settings';
import { VeoProvider, type VeoRequest, type VeoResult } from './veo';

export interface VideoProvider { readonly name: string; generateVideo(req: VeoRequest): Promise<VeoResult> }

let override: VideoProvider | null = null;
/** Test hook only. */
export function setVideoProviderOverride(p: VideoProvider | null) { override = p; }

/** Gemini Veo provider, or null when no Gemini API key is configured. */
export async function getVideoProvider(s: Settings): Promise<VideoProvider | null> {
  if (override) return override;
  const key = await getSecret('GEMINI_API_KEY');
  return key ? new VeoProvider({ apiKey: key, model: s.ai.video.veoModel }) : null;
}
