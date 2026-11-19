import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { storage } from '@/lib/storage';
import { setAiProviderOverride } from '@/lib/ai';
import { inspectPdf } from '@/lib/edu/pdf';
import { adFromPrint, approvePrint, createPrint, exportPrint, generateHero, imagePlanPrint, mockupPrint, pickHero, previewPrint, undoPrint, updatePrint, upscalePrint, uploadPrintAsset } from '@/lib/print/service';
import { captured, captureQueues, FakeAiProvider, logoPng, resetDb, seedBase } from './helpers';

beforeEach(async () => { await resetDb(); captureQueues(); });
const brief = { productId: 'business_card', activity: 'مقهى قهوة مختصة', business: 'Bean Café', sizeId: 'bc90x50', texts: { headline: 'قهوة مختصة', subline: 'محمصة يومية', name: 'أحمد علي', role: 'مدير العمليات', phone: '3600 1234', email: 'info@cafe.bh' } };

describe('PRINT DESIGN STUDIO — workflow', () => {
  it('request → analysis + 3 concepts → preview → approve → production files (re-opened) → mockup → ad from the approved version', async () => {
    const { admin, accounts } = await seedBase({ accounts: 2 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createPrint(brief, user);
    expect(p.status).toBe('designed');
    expect((p.concepts as unknown[]).length).toBe(3);
    // the client's ORIGINAL logo is stored and placed as-is
    const withLogo = await uploadPrintAsset(p.id, 'logo', await logoPng(), user);
    expect((withLogo.brief as { logoKey?: string }).logoKey).toMatch(/^print\//);
    const pv = await previewPrint(p.id, user);
    expect(pv.pages).toHaveLength(2);
    expect(pv.qa.checks.find((c) => c.id === 'client_logo')?.status).toBe('PASS');
    // files and ads need an approved design
    await expect(exportPrint(p.id, user)).rejects.toThrow(/اعتمد/);
    await expect(adFromPrint(p.id, { accountIds: [accounts[0].id], format: 'IMAGE_FEED', clientConsent: false }, user)).rejects.toThrow(/اعتمد/);
    await approvePrint(p.id, user);
    const ex = await exportPrint(p.id, user);
    const kinds = ex.files.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['pdf', 'png', 'jpg', 'source', 'meta']));
    const pdf = await storage().get(ex.files.find((f) => f.kind === 'pdf')!.key);
    const ins = inspectPdf(pdf); expect(ins.ok).toBe(true); expect(ins.pages).toHaveLength(2);
    expect(ins.pages[0].wMm).toBeCloseTo(96, 0); expect(ins.pages[0].hMm).toBeCloseTo(56, 0);
    expect(pdf.toString('latin1')).toContain('/Separation /CutContour');
    const png = await storage().get(ex.files.find((f) => f.kind === 'png')!.key);
    expect((await sharp(png).metadata()).width).toBe(Math.round(96 * 300 / 25.4));
    const ticket = JSON.parse((await storage().get(ex.files.find((f) => f.kind === 'meta')!.key)).toString());
    expect(ticket).toMatchObject({ product: 'business_card', trimMm: { w: 90, h: 50 }, bleedMm: 3 });
    expect(ex.qa.checks.find((c) => c.id === 'export')?.status).toBe('PASS');
    expect(ex.qa.checks.find((c) => c.id === 'color')?.status).toBe('NOT_VERIFIED'); // no printer ICC profile configured
    const mk = await mockupPrint(p.id, user);
    expect((await sharp(await storage().get(mk.key)).metadata()).format).toBe('jpeg');
    const ad = await adFromPrint(p.id, { accountIds: [accounts[0].id, accounts[1].id], format: 'IMAGE_FEED', clientConsent: false }, user);
    expect(captured.generate).toHaveLength(2);
    const job = captured.generate[0].data as { direction: { realPhotoKey: string; idea: string; contentType: string } };
    expect(job.direction.contentType).toBe('real_work'); expect(job.direction.idea).toContain('لا تذكر اسم العميل'); expect(job.direction.idea).toContain('لا تذكر أسعارًا');
    expect(ad.approvedHash).toBeTruthy();
  });

  it('editing an approved design revokes the approval; undo restores the previous version', async () => {
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createPrint(brief, user);
    await approvePrint(p.id, user);
    const u = await updatePrint(p.id, { brief: { texts: { headline: 'عنوان جديد' } } as never, note: 'تعديل العنوان' }, user);
    expect(u.status).toBe('designed'); expect(u.approvedHash).toBeNull();
    await expect(exportPrint(p.id, user)).rejects.toThrow(/اعتمد/);
    const c = await updatePrint(p.id, { conceptKey: 'B' }, user); expect(c.conceptKey).toBe('B');
    const back = await undoPrint(p.id, user);
    expect((back.brief as { texts: { headline: string } }).texts.headline).toBe('عنوان جديد');
    expect(back.conceptKey).not.toBe('B');
  });

  it('packaging without a supplier dieline: preview only — never called production-ready', async () => {
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createPrint({ productId: 'perfume_box', activity: 'متجر عطور', business: 'Oud House', texts: { headline: 'عود فاخر' } }, user);
    const pv = await previewPrint(p.id, user);
    expect(pv.qa.overall).toBe('BLOCKED');
    await approvePrint(p.id, user);
    const ex = await exportPrint(p.id, user);
    expect(ex.files.find((f) => f.kind === 'pdf')!.name).toContain('PREVIEW-ONLY');
    expect(ex.qa.productionReady).toBe(false);
  });

  it('large format and stickers export with the right geometry; AI picture only with a real key', async () => {
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const s = await createPrint({ productId: 'diecut_sticker', activity: 'محل ألعاب', business: 'Toy Land', sizeId: 's75', texts: { headline: 'Toy Land' } }, user);
    await expect(generateHero(s.id, user)).rejects.toThrow(/OpenAI/);
    await approvePrint(s.id, user);
    const ex = await exportPrint(s.id, user);
    const svg = (await storage().get(ex.files.find((f) => f.kind === 'svg')!.key)).toString();
    expect(svg).toContain('width="79mm"'); expect(svg).toContain('id="CutContour"');
    // with an image model: the picture is a separate layer; text never inside it
    setAiProviderOverride(new FakeAiProvider());
    const r = await createPrint({ productId: 'rollup', activity: 'عيادة أسنان', business: 'Smile', texts: { headline: 'ابتسامتك تبدأ هنا' } }, user);
    const g = await generateHero(r.id, user);
    expect((g.images as Record<string, string>).hero).toMatch(/^print\//);
    const pv = await previewPrint(r.id, user);
    const ppi = pv.qa.checks.find((c) => c.id === 'ppi')!;
    // 33 PPI at 3 m: below the 70 PPI target but above what the eye resolves there (~29 PPI) → accepted, and said so
    expect(ppi.status).toBe('PASS'); expect(ppi.detail).toContain('حد رؤية العين');
    const usage = await prisma.aiUsage.count().catch(() => -1);
    expect(usage === -1 || usage >= 1).toBe(true);
  });
});

describe('PRINT DESIGN STUDIO — finishing plates', () => {
  it('exports an aligned PNG + PDF plate per finish and shows a tinted preview', async () => {
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createPrint({ ...brief, finishes: ['gold_foil'], finishTarget: 'logo_headline' }, user);
    const pv = await previewPrint(p.id, user);
    expect(pv.pages.some((x) => x.label.includes('فويل ذهبي'))).toBe(true);
    await approvePrint(p.id, user);
    const ex = await exportPrint(p.id, user);
    const plate = ex.files.find((f) => f.name.endsWith('gold_foil.pdf'))!;
    const ins = inspectPdf(await storage().get(plate.key));
    expect(ins.ok).toBe(true); expect(ins.pages[0].wMm).toBeCloseTo(96, 0);
    expect((await storage().get(plate.key)).toString('latin1')).toContain('/DeviceGray');
    expect(ex.files.some((f) => f.name.endsWith('gold_foil.png'))).toBe(true);
    expect(ex.qa.checks.find((c) => c.id === 'finishing:gold_foil')?.status).toBe('PASS');
  });
});

describe('PRINT DESIGN STUDIO — packaging with the supplier dieline', () => {
  it('uploading a valid SVG dieline unblocks production; the PDF carries the creases; a bad file is refused', async () => {
    const { readFileSync } = await import('node:fs');
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createPrint({ productId: 'gift_box', activity: 'متجر هدايا', business: 'Gift Co', texts: { headline: 'هدية مميزة' } }, user);
    await expect(uploadPrintAsset(p.id, 'dieline', Buffer.from('not an svg'), user)).rejects.toThrow(/SVG/);
    const u = await uploadPrintAsset(p.id, 'dieline', readFileSync('tests/fixtures/tuck-box-dieline.svg'), user);
    expect((u.brief as { dieline?: { panels: unknown[] } }).dieline?.panels.length).toBeGreaterThan(3);
    const pv = await previewPrint(p.id, user);
    expect(pv.qa.checks.some((c) => c.status === 'BLOCKED')).toBe(false);
    await approvePrint(p.id, user);
    const ex = await exportPrint(p.id, user);
    const pdfFile = ex.files.find((f) => f.kind === 'pdf' && f.name.endsWith('-print.pdf'))!;
    expect(pdfFile).toBeTruthy();
    const pdf = (await storage().get(pdfFile.key)).toString('latin1');
    expect(pdf).toContain('/Separation /Fold'); expect(pdf.match(/\[3 2\] 0 d/g)?.length).toBeGreaterThanOrEqual(6);
    const svgOut = (await storage().get(ex.files.find((f) => f.kind === 'svg')!.key)).toString();
    expect(svgOut).toContain('id="Fold"');
  });
});

describe('PRINT DESIGN STUDIO — resolution for large formats', () => {
  it('shows the resolution before generating; upscaling smooths but QA still measures the original; a real photo can replace the AI picture', async () => {
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    setAiProviderOverride(new FakeAiProvider());
    const r = await createPrint({ productId: 'rollup', activity: 'عيادة أسنان', business: 'Smile', viewM: 3, texts: { headline: 'ابتسامتك تبدأ هنا' } }, user);
    const plan0 = await imagePlanPrint(r.id, user);
    expect(plan0.areaMm!.w).toBeGreaterThan(600); expect(plan0.ai!.ppi).toBeLessThan(plan0.target);
    expect(plan0.eye).toBeGreaterThan(0); expect(plan0.needPx!.w).toBeGreaterThan(1536);
    await generateHero(r.id, user);
    const before = (await previewPrint(r.id, user)).qa.checks.find((c) => c.id === 'ppi')!;
    const up = await upscalePrint(r.id, user);
    expect(up.factor).toBeGreaterThanOrEqual(2);
    const imgs = up.project.images as Record<string, string>;
    expect(imgs.hero_upscale).toBe(String(up.factor)); expect(imgs.hero_native).toMatch(/^\d+x\d+$/);
    const big = await sharp(await storage().get(imgs.hero)).metadata();
    expect(big.width).toBe(Number(imgs.hero_native.split('x')[0]) * up.factor);
    const after = (await previewPrint(r.id, user)).qa.checks.find((c) => c.id === 'ppi')!;
    expect(after.status).toBe(before.status); // enlarging does not change the verdict
    expect(after.detail).toContain('مكبّرة');
    // a real high-resolution photo
    const photo = await sharp({ create: { width: 6000, height: 9000, channels: 3, background: '#88aacc' } }).jpeg({ quality: 60 }).toBuffer();
    const withPhoto = await uploadPrintAsset(r.id, 'hero', photo, user);
    expect((withPhoto.images as Record<string, string>).hero_source).toBe('upload');
    expect((withPhoto.images as Record<string, string>).hero_upscale).toBeUndefined();
    const plan1 = await imagePlanPrint(r.id, user);
    expect(plan1.current!.source).toBe('upload'); expect(plan1.current!.ppi).toBeGreaterThan(plan0.ai!.ppi * 3);
    const qa = (await previewPrint(r.id, user)).qa.checks.find((c) => c.id === 'ppi')!;
    expect(qa.status).toBe('PASS'); expect(qa.detail).toContain('صورة مرفوعة');
  });
});

describe('PRINT DESIGN STUDIO — online client proof', () => {
  it('secret link with watermarked images; approval approves that exact version; edits make the link stale; changes need a note', async () => {
    const { createProof, publicProof, proofImage, decideProof } = await import('@/lib/print/proof');
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const p = await createPrint(brief, user);
    const pr = await createProof(p.id, user);
    expect(pr.path).toMatch(/^\/proof\/[\w-]{20,}$/); expect(pr.images).toBeGreaterThanOrEqual(3); // mockup + 2 faces
    const pub = await publicProof(pr.token);
    expect(pub).toMatchObject({ product: 'بطاقات الأعمال', stale: false, expired: false, decision: null });
    expect(JSON.stringify(pub)).not.toContain(admin.email); // no internal data on the public page
    const img = await proofImage(pr.token, 1);
    expect((await sharp(img).metadata()).format).toBe('jpeg');
    await expect(proofImage(pr.token, 99)).rejects.toThrow();
    await expect(publicProof('x'.repeat(24))).rejects.toThrow(/غير صالح/);
    // changes need a note; then the client asks for a change
    await expect(decideProof(pr.token, { decision: 'changes', name: 'سارة' }, '1.1.1.1')).rejects.toThrow(/التعديلات/);
    const ch = await decideProof(pr.token, { decision: 'changes', name: 'سارة', note: 'كبّر الشعار قليلًا' }, '1.1.1.1');
    expect(ch.status).toBe('changes');
    expect(await prisma.notification.count({ where: { code: 'PROOF_CHANGES' } })).toBe(1);
    // the shop edits → the old link refuses a decision
    await updatePrint(p.id, { brief: { texts: { headline: 'عنوان معدّل' } } as never }, user);
    expect((await publicProof(pr.token)).stale).toBe(true);
    await expect(decideProof(pr.token, { decision: 'approve', name: 'سارة' }, '1.1.1.1')).rejects.toThrow(/تغيّر التصميم/);
    // new proof for the new version (decision cleared) → the client approves → the project is approved at that version
    const pr2 = await createProof(p.id, user);
    expect((await publicProof(pr2.token)).decision).toBeNull();
    const ok = await decideProof(pr2.token, { decision: 'approve', name: 'سارة' }, '1.1.1.1');
    expect(ok.status).toBe('approved');
    const after = await prisma.printProject.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.status).toBe('approved'); expect(after.approvedHash).toBe(after.proofHash);
    await expect(decideProof(pr2.token, { decision: 'changes', name: 'سارة', note: 'تعديل' }, '1.1.1.1')).rejects.toThrow(/مسبقًا/);
    expect(await prisma.auditLog.count({ where: { action: 'print.proof.approved', actorLabel: 'client:سارة' } })).toBe(1);
    // export works right after the client's approval
    const ex = await exportPrint(p.id, user);
    expect(ex.files.some((f) => f.kind === 'pdf')).toBe(true);
    // expired links are refused
    await prisma.printProject.update({ where: { id: p.id }, data: { proofExpiresAt: new Date(Date.now() - 1000) } });
    expect((await publicProof(pr2.token)).expired).toBe(true);
    await expect(proofImage(pr2.token, 0)).rejects.toThrow(/صلاحية/);
  });
});

describe('PRINT DESIGN STUDIO — AI pictures for every size', () => {
  it('variants at the planned canvas, extended to a wide banner box, chosen by the user; stickers ask for transparency', async () => {
    class SpyAi extends FakeAiProvider { calls: { size: string; quality: string; background?: string }[] = []; async generateScene(p: string, o: Parameters<FakeAiProvider['generateScene']>[1]) { this.calls.push({ size: o.size, quality: o.quality, background: o.background }); return super.generateScene(p, o); } }
    const ai = new SpyAi(); setAiProviderOverride(ai);
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create'] };
    const bn = await createPrint({ productId: 'pvc_banner', activity: 'مطعم', business: 'Smash', texts: { headline: 'برجر مشوي على الفحم' } }, user);
    const plan = await imagePlanPrint(bn.id, user);
    expect(plan.plan!.size).toBe('1536x1024'); expect(plan.costs!.high).toBeGreaterThan(plan.costs!.low);
    const g = await generateHero(bn.id, user, { quality: 'high', variants: 3 });
    expect(ai.calls).toHaveLength(3); expect(ai.calls.every((c) => c.quality === 'high' && c.size === plan.plan!.size)).toBe(true);
    const imgs = g.images as Record<string, string>;
    const variants = imgs.hero_variants.split('|'); expect(variants).toHaveLength(3);
    if (plan.plan!.extend === 'horizontal') {
      const m = await sharp(await storage().get(imgs.hero)).metadata();
      expect(m.width! / m.height!).toBeCloseTo(plan.plan!.ratioBox, 1);
    }
    const picked = await pickHero(bn.id, 2, user);
    expect((picked.images as Record<string, string>).hero).toBe(variants[2]);
    // a die-cut sticker: transparent background requested, placed whole as the sticker's hero
    ai.calls.length = 0;
    const st = await createPrint({ productId: 'diecut_sticker', activity: 'محل ألعاب', business: 'Toy', sizeId: 's75', texts: { headline: 'Toy Land' } }, user);
    await generateHero(st.id, user);
    expect(ai.calls[0].background).toBe('transparent');
    const pv = await previewPrint(st.id, user);
    expect(pv.qa.checks.find((c) => c.id === 'overflow')?.status).toBe('PASS');
  });
});

describe('PRINT DESIGN STUDIO — quote from the design', () => {
  it('writes the item from the specs, prices typed by the shop, saved on the customer record, one WhatsApp message with the proof link', async () => {
    const { quoteDraft, quoteFromPrint, quoteMessage, specLine } = await import('@/lib/print/quote');
    const { createProof } = await import('@/lib/print/proof');
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create', 'ads:approve'] };
    const p = await createPrint({ ...brief, finishes: ['gold_foil'] }, user);
    const d = await quoteDraft(p.id, user);
    expect(d.desc).toContain('بطاقات الأعمال'); expect(d.desc).toContain('90×50'); expect(d.desc).toContain('وجهان'); expect(d.desc).toContain('فويل ذهبي');
    expect(d.lead).toBeNull();
    await expect(quoteFromPrint(p.id, { quantity: 500, unitPrice: 0.04 }, user)).rejects.toThrow(/عميل/); // no customer chosen
    await createProof(p.id, user);
    const q = await quoteFromPrint(p.id, { newLead: { name: 'سارة أحمد', contact: '36001234' }, quantity: 500, unitPrice: 0.04, designFee: 5 }, user);
    expect(q.quote.items).toHaveLength(2); expect(q.quote.items[0]).toMatchObject({ qty: 500, unit: 0.04 });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: q.leadId } });
    expect(lead.status).toBe('QUOTED'); expect(lead.valueBhd).toBeCloseTo(25, 3); expect(lead.name).toBe('سارة أحمد');
    expect((await prisma.printProject.findUniqueOrThrow({ where: { id: p.id } })).leadId).toBe(q.leadId);
    const m = (await quoteMessage(p.id, user, 'https://shop.example'))!;
    expect(m.text).toContain('25.000 د.ب'); expect(m.text).toContain('https://shop.example/proof/'); expect(m.wa).toMatch(/^https:\/\/wa\.me\/97336001234\?text=/);
    expect(m.text).toContain('33316319');
    // the quantity is commercial, not design: saving a quote never voids an approval
    await approvePrint(p.id, user);
    await quoteFromPrint(p.id, { quantity: 750, unitPrice: 0.04 }, user);
    const ex = await exportPrint(p.id, user); expect(ex.files.length).toBeGreaterThan(3);
    // updating keeps the same customer and quote number
    const q2 = await quoteFromPrint(p.id, { quantity: 1000, unitPrice: 0.035 }, user);
    expect(q2.leadId).toBe(q.leadId); expect(q2.quote.no).toBe(q.quote.no);
    expect(specLine((await prisma.printProject.findUniqueOrThrow({ where: { id: p.id } })).analysis as never, (await import('@/lib/print/brief')).BriefSchema.parse(p.brief))).toBe(d.desc);
  });
});

describe('PRINT DESIGN STUDIO — production tracking', () => {
  it('starts only after approval + files; «ready» prepares the customer message; «delivered» marks the customer as won', async () => {
    const { setStage, readyMessage } = await import('@/lib/print/production');
    const { quoteFromPrint } = await import('@/lib/print/quote');
    const { admin } = await seedBase({ accounts: 0 });
    const user = { sub: admin.id, email: admin.email, perms: ['ads:create', 'ads:approve'] };
    const p = await createPrint(brief, user);
    await expect(setStage(p.id, 'printing', user)).rejects.toThrow(/غير معتمد/);
    await approvePrint(p.id, user);
    await expect(setStage(p.id, 'printing', user)).rejects.toThrow(/ملفات/);
    await exportPrint(p.id, user);
    const q = await quoteFromPrint(p.id, { newLead: { name: 'خالد', contact: '33001122' }, quantity: 200, unitPrice: 0.05 }, user);
    for (const s of ['queued', 'printing', 'finishing'] as const) await setStage(p.id, s, user, s === 'printing' ? 'آلة 2' : undefined);
    const r = await setStage(p.id, 'ready', user);
    expect(r.stage).toBe('ready'); expect(r.history).toHaveLength(4); expect(r.history[1].note).toBe('آلة 2');
    const m = await readyMessage(p.id, user);
    expect(m.text).toContain('جاهز للاستلام'); expect(m.wa).toMatch(/wa\.me\/97333001122/);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: q.leadId } })).status).toBe('QUOTED');
    await setStage(p.id, 'delivered', user);
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: q.leadId } });
    expect(lead.status).toBe('WON'); expect(lead.wonAt).toBeTruthy();
  });
});
