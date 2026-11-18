import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getSettings } from '@/lib/settings';
import { BriefSchema, analyze } from '@/lib/print/brief';
import { available } from '@/lib/print/catalog';
import { buildConcepts, bestConcept } from '@/lib/print/concepts';
import { capsOf } from '@/lib/print/service';
/** PRODUCT ANALYSIS + CREATIVE CONCEPTS for a brief, without saving (live feedback in the form) */
export const POST = api('ads:create', async (req) => {
  const b = BriefSchema.parse(await req.json()); const s = await getSettings();
  const a = analyze(b, capsOf(s)); const concepts = buildConcepts(a, available(a.product, capsOf(s)).finishes);
  return NextResponse.json({ ok: true, analysis: a, concepts, best: bestConcept(concepts).key, available: available(a.product, capsOf(s)) });
});
