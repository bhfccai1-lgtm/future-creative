/** The create/campaign design choices and how they become a generation direction (pure — shared by the forms and tests). */
export interface DesignValues {
  renderMode: string; customPrompt: string; layout: string; designType: string; designStyle: string; channels: string[]; concept?: string; logoPosition?: string;
  reelStyle: string; reelDuration: string; audio: string; audioQuery: string; videoEngine?: string;
}
export const EMPTY_DESIGN: DesignValues = { renderMode: 'hybrid', customPrompt: '', layout: '', designType: '', designStyle: '', channels: [], reelStyle: 'standard', reelDuration: '', audio: '', audioQuery: '', videoEngine: '' };

/** Adds the design/channel/reel options of a DesignValues object to a direction payload. */
export function designDirection(v: DesignValues, format: string) {
  const d: Record<string, unknown> = {};
  if (v.renderMode) d.renderMode = v.renderMode;
  if ((v.renderMode === 'ai_full' || v.renderMode === 'hybrid') && v.customPrompt.trim()) d.customPrompt = v.customPrompt.trim();
  if (v.layout && v.renderMode === 'layered') d.layout = v.layout; // the fixed template only applies to the template method
  if (v.logoPosition && v.renderMode !== 'layered') d.logoPosition = v.logoPosition;
  if (v.designType) d.designType = v.designType;
  if (v.concept) d.concept = v.concept;
  if (v.designStyle) d.designStyle = v.designStyle;
  if (v.channels.length) d.channels = v.channels;
  if (format === 'REEL_VIDEO' || format === '') {
    if (v.reelStyle) d.reelStyle = v.reelStyle;
    if (v.videoEngine) d.videoEngine = v.videoEngine;
    if (v.reelDuration) d.reelDuration = Number(v.reelDuration);
    if (v.audio) d.audio = v.audio;
    if (v.audio === 'instagram' && v.audioQuery.trim()) d.audioQuery = v.audioQuery.trim();
  }
  return d;
}
