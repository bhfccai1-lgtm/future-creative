import { describe, expect, it } from 'vitest';
import { findBanned, stripBanned } from '@/lib/creative/banned';

const L = ['إذا ما صحتني القهوة'];
describe('banned phrases', () => {
  it('finds the phrase despite hamza/diacritics/punctuation differences', () => {
    expect(findBanned('صباحك كوب… اذا ما صحّتني القهوة، يصحيني تصميمك!', L)).toEqual(L);
    expect(findBanned('قهوة الصباح على كوب بتصميمك', L)).toEqual([]);
    expect(findBanned('', L)).toEqual([]);
  });
  it('strips it from free text and keeps the rest', () => {
    expect(stripBanned('ألوان فاتحة، «إذا ما صحتني القهوة» بدون وجوه', L)).toBe('ألوان فاتحة، بدون وجوه');
    expect(stripBanned('اذا ما صحتني القهوه', L)).toBe('');
    expect(stripBanned('نص عادي', [])).toBe('نص عادي');
  });
});
