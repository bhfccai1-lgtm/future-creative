/** Groups error messages by their shape: ids, urls, numbers and quotes removed, so «the same failure» counts once. */
export function errorSignature(msg: string): string {
  return msg.replace(/https?:\/\/\S+/g, '<url>').replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>').replace(/\bc[a-z0-9]{20,}\b/g, '<id>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hash>').replace(/["«»'`][^"«»'`]{1,60}["«»'`]/g, '"…"').replace(/\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ').trim().slice(0, 110) || '(بدون رسالة)';
}
