/**
 * Unlike a /v1/models listing, a non-empty chat response proves that the configured
 * router can actually reach an upstream model. The caller owns authentication and
 * translates any provider failures into safe, user-facing messages.
 */
export type FreeLlmProbeReply = {
  model?: string;
  choices: Array<{ message: { content: string | null } }>;
};

export async function probeFreeLlmGeneration(request: () => Promise<FreeLlmProbeReply>): Promise<{ servedModel: string }> {
  const response = await request();
  const content = response.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('FREELLM_EMPTY_COMPLETION');
  return { servedModel: response.model || 'unknown' };
}
