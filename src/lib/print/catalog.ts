/**
 * PRINT DESIGN MASTER — central product database. Every product belongs to a FAMILY that owns its layout engine,
 * geometry rules, prepress checks and mockup. Values are common starting points, NOT universal standards: bleed,
 * resolution and templates depend on the press, the supplier and the material (the shop overrides them in settings,
 * and products/materials/finishes it does not offer are disabled there).
 */
export type Family = 'card' | 'sheet' | 'folded' | 'multipage' | 'large_format' | 'sticker' | 'label' | 'packaging' | 'wrap' | 'apparel' | 'flat_gift' | 'stamp';
export type Cut = 'rect' | 'rounded' | 'circle' | 'oval' | 'custom';
export interface SizeOpt { id: string; ar: string; w: number; h: number }
export interface FamilySpec {
  ar: string;
  /** typical bleed in mm (0 = no bleed: e.g. sublimation/print-area products, stamps) */
  bleedMm: number;
  /** safe distance from the trim/cut edge in mm */
  safeMm: number;
  /** target effective resolution at final size (pixels per inch) — depends on viewing distance */
  ppi: number;
  /** what production needs that the system cannot invent */
  requires?: ('dieline' | 'product_template' | 'print_area')[];
  /** separate vector layers produced with the artwork */
  vectorLayers?: ('cut' | 'kiss_cut' | 'fold' | 'perforation' | 'glue' | 'white' | 'foil' | 'spot_uv')[];
  mockup: 'cards' | 'sheet' | 'brochure' | 'book' | 'rollup' | 'banner' | 'stickers' | 'label' | 'box' | 'bag' | 'mug' | 'bottle' | 'tshirt' | 'cap' | 'tote' | 'canvas' | 'flat' | 'stamp';
  rules: string[];
}

export const FAMILIES: Record<Family, FamilySpec> = {
  card: { ar: 'بطاقات', bleedMm: 3, safeMm: 4, ppi: 300, vectorLayers: ['foil', 'spot_uv'], mockup: 'cards', rules: ['وجه أمامي وخلفي', 'بيانات الاتصال لا تقل عن 7 نقاط', 'لا نصوص مهمة على بُعد أقل من 4 مم من حافة القص', 'الفويل وSpot UV طبقات منفصلة 100٪ أسود'] },
  sheet: { ar: 'مطبوعات ورقية مفردة', bleedMm: 3, safeMm: 5, ppi: 300, mockup: 'sheet', rules: ['عنوان واضح من مسافة القراءة', 'تسلسل بصري: عنوان ← فائدة ← تفاصيل ← تواصل', 'النزيف لكل خلفية تمتد للحافة'] },
  folded: { ar: 'مطويات', bleedMm: 3, safeMm: 5, ppi: 300, vectorLayers: ['fold'], mockup: 'brochure', rules: ['عدد الألواح وطريقة الطي تحدد الترتيب', 'اللوح الداخلي في الطي الثلاثي أضيق 2 مم ليُطوى دون تجعّد', 'مسافة 5 مم على الأقل من كل خط طي', 'مطابقة الوجهين بعد الطي'] },
  multipage: { ar: 'كتب ومطبوعات متعددة الصفحات', bleedMm: 3, safeMm: 8, ppi: 300, mockup: 'book', rules: ['التدبيس: عدد الصفحات من مضاعفات 4', 'هامش داخلي أكبر لمنطقة التجليد', 'الكعب يُحسب من عدد الأوراق وسماكة الورق', 'ترقيم الصفحات'] },
  large_format: { ar: 'لوحات وإعلانات كبيرة', bleedMm: 10, safeMm: 30, ppi: 100, mockup: 'rollup', rules: ['الدقة حسب مسافة المشاهدة (لا يلزم 300 PPI)', 'منطقة تثبيت/كعب للرول أب', 'العنوان يُقرأ من المسافة المستهدفة', 'مساحة للعيون المعدنية أو الحواف المطوية في البنرات'] },
  sticker: { ar: 'استيكرات', bleedMm: 2, safeMm: 2, ppi: 300, requires: [], vectorLayers: ['cut', 'kiss_cut', 'white'], mockup: 'stickers', rules: ['مسار قص Vector مستقل (CutContour)', 'نزيف حول خط القص', 'مسافة بين القطع في الورقة (3 مم على الأقل)', 'شفاف: طبقة حبر أبيض عند الحاجة', 'الخامة حسب الاستخدام: مقاوم للماء/الشمس'] },
  label: { ar: 'ملصقات المنتجات', bleedMm: 2, safeMm: 2.5, ppi: 300, vectorLayers: ['cut'], mockup: 'label', rules: ['مقاس الملصق يطابق سطح العبوة', 'الباركود بتباين كافٍ وحجم لا يقل عن 80٪', 'البيانات الإلزامية للمنتج من العميل فقط'] },
  packaging: { ar: 'تغليف وعبوات', bleedMm: 3, safeMm: 3, ppi: 300, requires: ['dieline'], vectorLayers: ['cut', 'fold', 'perforation', 'glue'], mockup: 'box', rules: ['يُستخدم Dieline المعتمد من المورد فقط', 'فصل القص والثني والتخريم واللصق في طبقات', 'اتجاه العناصر حسب الوجه بعد التركيب', 'لا عناصر مهمة على مناطق اللصق والتداخل', 'ملامسة الأغذية تحتاج خامات وأحبار معتمدة من المورد'] },
  wrap: { ar: 'منتجات أسطوانية', bleedMm: 0, safeMm: 5, ppi: 300, requires: ['product_template'], mockup: 'mug', rules: ['قالب الطباعة الخاص بالمنتج (منطقة الطباعة)', 'مكان المقبض والفراغ حوله', 'معاينة الالتفاف حول السطح', 'التسامي (Sublimation) يحتاج ألوانًا معكوسة عند الطباعة حسب الجهاز'] },
  apparel: { ar: 'ملابس وأقمشة', bleedMm: 0, safeMm: 0, ppi: 300, requires: ['print_area'], mockup: 'tshirt', rules: ['منطقة طباعة حسب المقاس والطريقة (DTF/تسامي/طباعة حرارية)', 'خلفية شفافة للـDTF', 'حبر أبيض تحت الألوان على الأقمشة الداكنة', 'لا تفاصيل أرفع من 1 مم'] },
  flat_gift: { ar: 'هدايا ومنتجات مسطحة', bleedMm: 3, safeMm: 4, ppi: 300, requires: ['product_template'], mockup: 'flat', rules: ['قالب المنتج من المورد', 'حواف مستديرة حسب المنتج'] },
  stamp: { ar: 'أختام', bleedMm: 0, safeMm: 1, ppi: 600, vectorLayers: ['cut'], mockup: 'stamp', rules: ['لون واحد', 'خطوط لا تقل عن 0.3 مم', 'نسخة معكوسة لصناعة الختم'] },
};

export interface Product { id: string; cat: string; family: Family; ar: string; en: string; sizes: SizeOpt[]; sides: 1 | 2; pages?: number; cut?: Cut; materials: string[]; finishes: string[]; methods: string[]; viewM?: number }
export const CATEGORIES: Record<string, { ar: string; en: string }> = {
  A: { ar: 'المطبوعات التجارية', en: 'Business print' }, B: { ar: 'المطبوعات التسويقية', en: 'Marketing print' }, C: { ar: 'التغليف والعبوات', en: 'Packaging' },
  D: { ar: 'الاستيكرات والملصقات', en: 'Stickers & labels' }, E: { ar: 'اللوحات والإعلانات', en: 'Signage & displays' }, F: { ar: 'المنتجات والهدايا', en: 'Products & gifts' },
  G: { ar: 'الملابس والأقمشة', en: 'Apparel & textiles' }, H: { ar: 'المطبوعات التعليمية', en: 'Educational print' }, I: { ar: 'المناسبات والاحتفالات', en: 'Events & celebrations' },
  J: { ar: 'الكتب ومتعددة الصفحات', en: 'Books & multi-page' }, K: { ar: 'المنتجات الخاصة', en: 'Special products' },
};

const sz = (id: string, ar: string, w: number, h: number): SizeOpt => ({ id, ar, w, h });
const A3 = sz('A3', 'A3', 297, 420), A4 = sz('A4', 'A4', 210, 297), A5 = sz('A5', 'A5', 148, 210), A6 = sz('A6', 'A6', 105, 148), DL = sz('DL', 'DL', 99, 210);
const BC = [sz('bc90x50', '90×50 مم', 90, 50), sz('bc85x55', '85×55 مم', 85, 55), sz('bc90x55', '90×55 مم', 90, 55)];
const CR80 = sz('cr80', 'بطاقة بلاستيك 85.6×54', 85.6, 54);
const PAPER = ['coated_paper', 'uncoated_paper', 'art_card', 'textured_paper', 'kraft_paper'];
const CARD_FIN = ['matte_lam', 'gloss_lam', 'soft_touch', 'spot_uv', 'gold_foil', 'silver_foil', 'emboss', 'deboss', 'round_corners'];
const LITHO = ['digital', 'offset'];
const P = (id: string, cat: string, family: Family, ar: string, en: string, o: Partial<Product> = {}): Product => ({ id, cat, family, ar, en, sizes: [A4], sides: 1, materials: PAPER, finishes: [], methods: LITHO, ...o });

export const PRODUCTS: Product[] = [
  // A. business print
  P('business_card', 'A', 'card', 'بطاقات الأعمال', 'Business cards', { sizes: BC, sides: 2, materials: ['art_card', 'textured_paper', 'kraft_paper', 'pvc'], finishes: CARD_FIN }),
  P('letterhead', 'A', 'sheet', 'الأوراق الرسمية', 'Letterheads', { materials: ['uncoated_paper', 'textured_paper'] }),
  P('envelope', 'A', 'sheet', 'الأظرف', 'Envelopes', { sizes: [sz('dl_env', 'DL 220×110', 220, 110), sz('c5', 'C5 229×162', 229, 162), sz('c4', 'C4 324×229', 324, 229)], materials: ['uncoated_paper', 'kraft_paper'] }),
  P('invoice_book', 'A', 'sheet', 'دفاتر الفواتير', 'Invoice books', { sizes: [A5, A4], materials: ['ncr_paper'], finishes: ['numbering', 'perforation', 'binding'] }),
  P('receipt_book', 'A', 'sheet', 'سندات القبض', 'Receipt books', { sizes: [sz('receipt', '210×99', 210, 99), A5], materials: ['ncr_paper'], finishes: ['numbering', 'perforation', 'binding'] }),
  P('folder', 'A', 'packaging', 'الملفات التجارية', 'Presentation folders', { sizes: [sz('folder_a4', 'ملف A4 (مفتوح 470×330)', 470, 330)], materials: ['art_card'], finishes: ['matte_lam', 'spot_uv', 'gold_foil'] }),
  P('certificate', 'A', 'sheet', 'الشهادات', 'Certificates', { sizes: [A4, A3], materials: ['art_card', 'textured_paper'], finishes: ['gold_foil', 'emboss'] }),
  P('id_card', 'A', 'card', 'بطاقات التعريف', 'ID cards', { sizes: [CR80], sides: 2, materials: ['pvc'], methods: ['card_printer'], finishes: [] }),
  P('loyalty_card', 'A', 'card', 'بطاقات الولاء', 'Loyalty cards', { sizes: [...BC, CR80], sides: 2, finishes: CARD_FIN }),
  P('gift_card', 'A', 'card', 'بطاقات الهدايا', 'Gift cards', { sizes: [CR80, ...BC], sides: 2, finishes: CARD_FIN }),
  // B. marketing
  P('flyer', 'B', 'sheet', 'المنشورات', 'Flyers', { sizes: [A5, A4, A6, DL], sides: 2, finishes: ['matte_lam', 'gloss_lam'] }),
  P('brochure', 'B', 'folded', 'المطويات', 'Brochures', { sizes: [sz('a4_tri', 'A4 ثلاث طيات (مفتوح 297×210)', 297, 210), sz('a4_bi', 'A4 طية واحدة (مفتوح 297×210)', 297, 210)], sides: 2, finishes: ['matte_lam', 'gloss_lam'] }),
  P('catalog', 'B', 'multipage', 'الكتالوجات', 'Catalogs', { sizes: [A4, A5], sides: 2, pages: 16, finishes: ['saddle_stitch', 'perfect_bind', 'matte_lam'] }),
  P('booklet', 'B', 'multipage', 'الكتيبات', 'Booklets', { sizes: [A5, A4], sides: 2, pages: 8, finishes: ['saddle_stitch'] }),
  P('poster', 'B', 'sheet', 'البوسترات', 'Posters', { sizes: [A3, A4, sz('a2', 'A2', 420, 594), sz('a1', 'A1', 594, 841)], finishes: ['matte_lam', 'gloss_lam'], viewM: 1.5 }),
  P('menu', 'B', 'sheet', 'قوائم الطعام', 'Menus', { sizes: [A4, A3, DL], sides: 2, materials: ['art_card', 'synthetic_paper'], finishes: ['matte_lam', 'soft_touch'] }),
  P('promo_card', 'B', 'card', 'البطاقات الترويجية', 'Promotional cards', { sizes: [A6, ...BC], sides: 2, finishes: CARD_FIN }),
  P('door_hanger', 'B', 'sticker', 'تعليقات الأبواب', 'Door hangers', { sizes: [sz('door', '100×250', 100, 250)], sides: 2, cut: 'custom', materials: ['art_card'], methods: LITHO }),
  P('coupon', 'B', 'card', 'قسائم الخصم', 'Coupons', { sizes: [DL, sz('coupon', '150×70', 150, 70)], sides: 2, finishes: ['numbering', 'perforation'] }),
  // C. packaging
  ...([['paper_bag', 'الأكياس الورقية', 'Paper bags', 'bag'], ['box', 'علب التغليف', 'Packaging boxes', 'box'], ['gift_box', 'علب الهدايا', 'Gift boxes', 'box'], ['food_pack', 'تغليف الأطعمة', 'Food packaging', 'box'], ['perfume_box', 'علب العطور', 'Perfume boxes', 'box'], ['sleeve', 'أغطية التغليف', 'Sleeves', 'box']] as const).map(([id, ar, en]) =>
    P(id, 'C', 'packaging', ar, en, { sizes: [sz('dieline', 'حسب Dieline المورد', 0, 0)], materials: id === 'food_pack' ? ['food_safe_board'] : id === 'paper_bag' ? ['kraft_paper', 'art_card'] : ['art_card', 'rigid_board', 'kraft_paper'], finishes: ['matte_lam', 'soft_touch', 'spot_uv', 'gold_foil', 'emboss'] })),
  P('wrapping_paper', 'C', 'sheet', 'ورق التغليف', 'Wrapping paper', { sizes: [sz('wrap', '500×700', 500, 700)], materials: ['coated_paper', 'kraft_paper'] }),
  P('hang_tag', 'C', 'card', 'بطاقات تعليق المنتجات', 'Hang tags', { sizes: [sz('tag', '50×90', 50, 90)], sides: 2, finishes: [...CARD_FIN, 'hole_punch'] }),
  P('product_label', 'C', 'label', 'ملصقات المنتجات', 'Product labels', { sizes: [sz('l60x40', '60×40', 60, 40), sz('l100x70', '100×70', 100, 70)], cut: 'rounded', materials: ['paper_label', 'vinyl', 'transparent_film'], methods: ['digital_label'] }),
  // D. stickers
  ...([['vinyl_sticker', 'استيكر فينيل', 'Vinyl stickers', 'vinyl', 'circle'], ['paper_sticker', 'استيكر ورقي', 'Paper stickers', 'paper_label', 'circle'], ['transparent_sticker', 'استيكر شفاف', 'Transparent stickers', 'transparent_film', 'circle'], ['waterproof_sticker', 'استيكر مقاوم للماء', 'Waterproof stickers', 'vinyl', 'rounded'], ['diecut_sticker', 'استيكر بقص مخصص', 'Die-cut stickers', 'vinyl', 'custom'], ['kisscut_sheet', 'ورقة استيكرات Kiss-Cut', 'Kiss-cut sticker sheets', 'vinyl', 'circle'], ['holographic_sticker', 'استيكر هولوغرام', 'Holographic stickers', 'holographic_vinyl', 'circle'], ['window_sticker', 'استيكر واجهات', 'Window stickers', 'transparent_film', 'rect'], ['floor_sticker', 'استيكر أرضيات', 'Floor stickers', 'floor_vinyl', 'circle'], ['bottle_label', 'ملصقات القوارير', 'Bottle labels', 'vinyl', 'rounded'], ['seal', 'ختم تغليف', 'Packaging seals', 'paper_label', 'circle'], ['barcode_label', 'ملصقات الباركود', 'Barcode labels', 'paper_label', 'rect']] as const).map(([id, ar, en, mat, cut]) =>
    P(id, 'D', id === 'bottle_label' || id === 'barcode_label' ? 'label' : 'sticker', ar, en, { sizes: id === 'window_sticker' ? [sz('w600', '600×400', 600, 400)] : id === 'floor_sticker' ? [sz('f400', 'Ø 400', 400, 400)] : id === 'bottle_label' ? [sz('bl', '200×60', 200, 60)] : id === 'barcode_label' ? [sz('bar', '50×30', 50, 30)] : [sz('s50', '50×50', 50, 50), sz('s75', '75×75', 75, 75), sz('s100', '100×100', 100, 100)], cut, materials: [mat, 'vinyl', 'paper_label'], finishes: ['matte_lam', 'gloss_lam'], methods: ['eco_solvent', 'uv', 'digital_label'], viewM: id === 'floor_sticker' ? 1.5 : undefined })),
  // E. signage
  P('rollup', 'E', 'large_format', 'رول أب', 'Roll-up banner', { sizes: [sz('ru85', '85×200 سم', 850, 2000), sz('ru100', '100×200 سم', 1000, 2000), sz('ru120', '120×200 سم', 1200, 2000)], materials: ['pvc_banner', 'fabric'], methods: ['eco_solvent', 'uv', 'sublimation'], viewM: 3 }),
  P('xbanner', 'E', 'large_format', 'إكس بنر', 'X-banner', { sizes: [sz('x60', '60×160 سم', 600, 1600), sz('x80', '80×180 سم', 800, 1800)], materials: ['pvc_banner'], methods: ['eco_solvent'], viewM: 3 }),
  P('pvc_banner', 'E', 'large_format', 'بنر PVC', 'PVC banner', { sizes: [sz('b300', '300×100 سم', 3000, 1000), sz('b200', '200×100 سم', 2000, 1000)], materials: ['pvc_banner'], finishes: ['eyelets', 'hemming'], methods: ['eco_solvent', 'uv'], viewM: 8 }),
  P('fabric_banner', 'E', 'large_format', 'بنر قماش', 'Fabric banner', { sizes: [sz('fb', '200×100 سم', 2000, 1000)], materials: ['fabric'], methods: ['sublimation'], finishes: ['hemming'], viewM: 5 }),
  P('foam_board', 'E', 'large_format', 'فوم بورد', 'Foam board', { sizes: [sz('fbA1', 'A1', 594, 841), sz('fb70', '70×100 سم', 700, 1000)], materials: ['foam_board'], methods: ['uv'], viewM: 2 }),
  P('acrylic_sign', 'E', 'large_format', 'لوحة أكريليك', 'Acrylic sign', { sizes: [sz('ac', '60×40 سم', 600, 400)], materials: ['acrylic'], methods: ['uv'], finishes: ['laser_cut'], viewM: 2 }),
  P('indoor_sign', 'E', 'large_format', 'لوحات داخلية', 'Indoor signage', { sizes: [sz('in', '60×40 سم', 600, 400)], materials: ['foam_board', 'acrylic', 'pvc_board'], methods: ['uv'], viewM: 3 }),
  P('outdoor_sign', 'E', 'large_format', 'لوحات خارجية', 'Outdoor signage', { sizes: [sz('out', '300×100 سم', 3000, 1000)], materials: ['pvc_banner', 'composite_panel'], methods: ['eco_solvent', 'uv'], viewM: 15 }),
  P('exhibition', 'E', 'large_format', 'خلفيات المعارض', 'Exhibition displays', { sizes: [sz('pop', '300×225 سم', 3000, 2250)], materials: ['fabric', 'pvc_banner'], methods: ['sublimation', 'eco_solvent'], viewM: 4 }),
  P('counter_display', 'E', 'packaging', 'ستاند الكاونتر', 'Counter displays', { sizes: [sz('dieline', 'حسب Dieline المورد', 0, 0)], materials: ['art_card', 'rigid_board'] }),
  P('window_graphics', 'E', 'large_format', 'جرافيك الواجهات', 'Window graphics', { sizes: [sz('wg', '200×150 سم', 2000, 1500)], materials: ['transparent_film', 'perforated_vinyl'], methods: ['eco_solvent'], viewM: 4 }),
  P('vehicle', 'E', 'large_format', 'جرافيك السيارات', 'Vehicle graphics', { sizes: [sz('veh', 'حسب قالب السيارة', 0, 0)], materials: ['cast_vinyl'], methods: ['eco_solvent'], viewM: 10 }),
  // F. products & gifts
  P('mug', 'F', 'wrap', 'أكواب مطبوعة', 'Printed mugs', { sizes: [sz('mug11', 'كوب 11 أونصة — منطقة 200×85', 200, 85), sz('mug15', 'كوب 15 أونصة — منطقة 215×95', 215, 95)], materials: ['ceramic_coated'], methods: ['sublimation'] }),
  P('magic_mug', 'F', 'wrap', 'أكواب سحرية', 'Magic mugs', { sizes: [sz('mug11', 'كوب 11 أونصة — منطقة 200×85', 200, 85)], materials: ['ceramic_magic'], methods: ['sublimation'] }),
  P('tumbler', 'F', 'wrap', 'كاسات حرارية', 'Tumblers', { sizes: [sz('tum20', '20 أونصة — منطقة 230×200', 230, 200)], materials: ['steel_coated'], methods: ['sublimation', 'uv'] }),
  P('bottle', 'F', 'wrap', 'قوارير المياه', 'Water bottles', { sizes: [sz('bot', 'منطقة 210×110', 210, 110)], materials: ['steel_coated'], methods: ['sublimation', 'uv'] }),
  ...([['keychain', 'ميداليات', 'Keychains', 50, 30], ['mousepad', 'ماوس باد', 'Mouse pads', 240, 200], ['coaster', 'قواعد أكواب', 'Coasters', 95, 95], ['phone_case', 'أغطية الجوال', 'Phone cases', 0, 0], ['acrylic_gift', 'هدايا أكريليك', 'Acrylic gifts', 150, 200], ['photo_frame', 'براويز الصور', 'Photo frames', 200, 250], ['promo_gift', 'هدايا ترويجية', 'Promotional gifts', 0, 0]] as const).map(([id, ar, en, w, h]) =>
    P(id, 'F', 'flat_gift', ar, en, { sizes: [sz(id, w ? `${w}×${h}` : 'حسب قالب المنتج', w, h)], materials: id === 'acrylic_gift' ? ['acrylic'] : ['sublimation_blank'], methods: id === 'acrylic_gift' ? ['uv'] : ['sublimation', 'uv'] })),
  P('canvas', 'F', 'large_format', 'لوحات كانفس', 'Canvas prints', { sizes: [sz('c40', '40×60 سم', 400, 600), sz('c60', '60×90 سم', 600, 900)], materials: ['canvas'], methods: ['eco_solvent', 'pigment'], finishes: ['stretcher_wrap'], viewM: 1.5 }),
  // G. apparel
  ...([['tshirt', 'تيشيرتات', 'T-shirts', 'tshirt'], ['polo', 'قمصان بولو', 'Polo shirts', 'tshirt'], ['cap', 'قبعات', 'Caps', 'cap'], ['tote', 'حقائب قماش', 'Tote bags', 'tote'], ['uniform', 'زي موحد', 'Uniforms', 'tshirt'], ['hoodie', 'هودي', 'Hoodies', 'tshirt'], ['fabric_print', 'طباعة أقمشة', 'Fabric prints', 'tshirt'], ['heat_transfer', 'تصاميم الطباعة الحرارية', 'Heat transfer designs', 'tshirt'], ['dtf', 'تصاميم DTF', 'DTF print artwork', 'tshirt'], ['sublimation_art', 'تصاميم التسامي', 'Sublimation artwork', 'tshirt']] as const).map(([id, ar, en]) =>
    P(id, 'G', 'apparel', ar, en, { sizes: id === 'cap' ? [sz('cap', 'أمام القبعة 100×55', 100, 55)] : id === 'tote' ? [sz('tote', '280×300', 280, 300)] : [sz('chest', 'شعار الصدر 100×100', 100, 100), sz('front_a4', 'أمامي A4 (210×297)', 210, 297), sz('front_a3', 'أمامي A3 (297×420)', 297, 420)], materials: ['cotton', 'polyester'], methods: id === 'sublimation_art' ? ['sublimation'] : ['dtf', 'heat_transfer', 'screen'] })),
  // H. educational (the full engine lives in EDUCATION MASTER — these are quick single designs)
  P('edu_poster', 'H', 'sheet', 'بوسترات تعليمية', 'Educational posters', { sizes: [A3, A4], viewM: 2 }),
  P('school_brochure', 'H', 'folded', 'مطويات مدرسية', 'School brochures', { sizes: [sz('a4_tri', 'A4 ثلاث طيات', 297, 210)], sides: 2 }),
  P('flashcard', 'H', 'card', 'بطاقات تعليمية', 'Flashcards', { sizes: [A6, sz('fc', '90×60', 90, 60)], sides: 2 }),
  P('worksheet', 'H', 'sheet', 'أوراق عمل', 'Worksheets', { sizes: [A4] }),
  P('learning_chart', 'H', 'sheet', 'لوحات تعليمية', 'Learning charts', { sizes: [A3, sz('a2', 'A2', 420, 594)], viewM: 2 }),
  P('activity_book', 'H', 'multipage', 'كتب أنشطة', 'Activity books', { sizes: [A4, A5], sides: 2, pages: 12 }),
  P('classroom_decor', 'H', 'sticker', 'زينة الفصول', 'Classroom decorations', { sizes: [A4, A3], cut: 'custom' }),
  P('edu_sticker', 'H', 'sticker', 'استيكرات تعليمية', 'Educational stickers', { sizes: [sz('s50', '50×50', 50, 50)], cut: 'circle', materials: ['paper_label', 'vinyl'] }),
  P('student_cert', 'H', 'sheet', 'شهادات الطلاب', 'Student certificates', { sizes: [A4], materials: ['art_card'] }),
  P('school_project', 'H', 'sheet', 'مشاريع مدرسية', 'School projects', { sizes: [A4, A3] }),
  // I. events
  P('wedding_invite', 'I', 'card', 'دعوات الزفاف', 'Wedding invitations', { sizes: [sz('inv', '150×210', 150, 210), sz('inv_sq', '150×150', 150, 150)], sides: 2, finishes: CARD_FIN }),
  P('graduation_card', 'I', 'card', 'بطاقات التخرج', 'Graduation cards', { sizes: [A5, A6], sides: 2, finishes: CARD_FIN }),
  P('birthday_decor', 'I', 'sticker', 'زينة أعياد الميلاد', 'Birthday decorations', { sizes: [A4], cut: 'custom' }),
  P('baby_shower', 'I', 'card', 'بطاقات استقبال المواليد', 'Baby shower cards', { sizes: [A6, sz('inv_sq', '150×150', 150, 150)], sides: 2, finishes: CARD_FIN }),
  P('welcome_board', 'I', 'large_format', 'لوحات ترحيب', 'Event welcome boards', { sizes: [sz('wb', '60×90 سم', 600, 900)], materials: ['foam_board', 'acrylic'], methods: ['uv'], viewM: 3 }),
  P('photo_props', 'I', 'sticker', 'إكسسوارات التصوير', 'Photo booth props', { sizes: [A4], cut: 'custom', materials: ['art_card', 'foam_board'] }),
  P('thank_you', 'I', 'card', 'بطاقات الشكر', 'Thank-you cards', { sizes: [A6, ...BC], sides: 2, finishes: CARD_FIN }),
  P('ramadan', 'I', 'sheet', 'تصاميم رمضان', 'Ramadan designs', { sizes: [A4, A5, sz('inv_sq', '150×150', 150, 150)] }),
  P('eid', 'I', 'sheet', 'تصاميم العيد', 'Eid designs', { sizes: [A5, sz('inv_sq', '150×150', 150, 150)] }),
  P('corporate_event', 'I', 'sheet', 'مطبوعات فعاليات الشركات', 'Corporate event materials', { sizes: [A4, A3] }),
  // J. multi-page
  ...([['book', 'الكتب', 'Books', 120, ['perfect_bind', 'hard_cover']], ['magazine', 'المجلات', 'Magazines', 32, ['saddle_stitch', 'perfect_bind']], ['notebook', 'الدفاتر', 'Notebooks', 96, ['spiral', 'perfect_bind']], ['diary', 'المفكرات', 'Diaries', 192, ['hard_cover', 'perfect_bind']], ['calendar', 'التقاويم', 'Calendars', 28, ['spiral']], ['manual', 'الأدلة', 'Manuals', 24, ['saddle_stitch']], ['training_guide', 'أدلة التدريب', 'Training guides', 40, ['saddle_stitch', 'spiral']], ['annual_report', 'التقارير السنوية', 'Annual reports', 48, ['perfect_bind']], ['workbook', 'كراسات مدرسية', 'School workbooks', 32, ['saddle_stitch']]] as const).map(([id, ar, en, pages, fin]) =>
    P(id, 'J', 'multipage', ar, en, { sizes: [A4, A5, sz('b5', 'B5 176×250', 176, 250)], sides: 2, pages, finishes: [...fin, 'matte_lam'] })),
  // K. special
  P('rubber_stamp', 'K', 'stamp', 'أختام مطاطية', 'Rubber stamps', { sizes: [sz('st40', 'Ø 40', 40, 40), sz('st58', '58×22', 58, 22)], cut: 'circle', materials: ['rubber'], methods: ['laser_engrave'] }),
  P('emboss_seal', 'K', 'stamp', 'أختام بارزة', 'Embossed seals', { sizes: [sz('es', 'Ø 42', 42, 42)], cut: 'circle', materials: ['metal_die'], methods: ['emboss_die'] }),
  P('acrylic_display', 'K', 'flat_gift', 'ستاندات أكريليك', 'Acrylic displays', { sizes: [sz('ad', '150×210', 150, 210)], materials: ['acrylic'], methods: ['uv'], finishes: ['laser_cut'] }),
  P('laser_cut', 'K', 'sticker', 'تصاميم القص بالليزر', 'Laser-cut designs', { sizes: [A4], cut: 'custom', materials: ['acrylic', 'mdf'], methods: ['laser_cut'] }),
  P('uv_item', 'K', 'flat_gift', 'منتجات طباعة UV', 'UV printed items', { sizes: [sz('uv', 'حسب قالب المنتج', 0, 0)], materials: ['various'], methods: ['uv'] }),
  P('custom_shape', 'K', 'sticker', 'مطبوعات بأشكال خاصة', 'Custom-shaped prints', { sizes: [A5], cut: 'custom' }),
  P('foil_print', 'K', 'card', 'مطبوعات بالفويل', 'Foil-stamped prints', { sizes: [...BC, A5], sides: 2, finishes: ['gold_foil', 'silver_foil'] }),
  P('special_pack', 'K', 'packaging', 'تغليف خاص', 'Specialty packaging', { sizes: [sz('dieline', 'حسب Dieline المورد', 0, 0)], materials: ['rigid_board', 'art_card'], finishes: ['soft_touch', 'gold_foil', 'emboss'] }),
];

export const MATERIALS: Record<string, { ar: string; outdoor?: boolean; waterproof?: boolean; food?: boolean; transparent?: boolean }> = {
  coated_paper: { ar: 'ورق مطلي (كوشيه)' }, uncoated_paper: { ar: 'ورق غير مطلي' }, textured_paper: { ar: 'ورق بملمس' }, kraft_paper: { ar: 'ورق كرافت' }, art_card: { ar: 'كرتون آرت' },
  ncr_paper: { ar: 'ورق كربوني NCR' }, synthetic_paper: { ar: 'ورق صناعي مقاوم للماء', waterproof: true }, pvc: { ar: 'PVC', waterproof: true },
  paper_label: { ar: 'ورق لاصق' }, vinyl: { ar: 'فينيل لاصق', outdoor: true, waterproof: true }, transparent_film: { ar: 'فيلم شفاف', waterproof: true, transparent: true },
  holographic_vinyl: { ar: 'فينيل هولوغرام', waterproof: true }, floor_vinyl: { ar: 'فينيل أرضيات مانع للانزلاق', waterproof: true }, cast_vinyl: { ar: 'فينيل كاست للسيارات', outdoor: true, waterproof: true },
  perforated_vinyl: { ar: 'فينيل مثقب (One Way Vision)', outdoor: true, waterproof: true, transparent: true },
  pvc_banner: { ar: 'بنر PVC (فلكس)', outdoor: true, waterproof: true }, fabric: { ar: 'قماش طباعة' }, foam_board: { ar: 'فوم بورد' }, pvc_board: { ar: 'لوح PVC (فوركس)', outdoor: true, waterproof: true },
  composite_panel: { ar: 'ألوكوبوند', outdoor: true, waterproof: true }, acrylic: { ar: 'أكريليك', waterproof: true, transparent: true }, canvas: { ar: 'كانفس' }, mdf: { ar: 'خشب MDF' },
  rigid_board: { ar: 'كرتون مقوى (علب فاخرة)' }, food_safe_board: { ar: 'كرتون ملامس للأغذية (يحتاج شهادة المورد)', food: true },
  ceramic_coated: { ar: 'سيراميك مطلي للتسامي' }, ceramic_magic: { ar: 'سيراميك سحري' }, steel_coated: { ar: 'ستانلس مطلي' }, sublimation_blank: { ar: 'خامات تسامي جاهزة' },
  cotton: { ar: 'قطن' }, polyester: { ar: 'بوليستر' }, rubber: { ar: 'مطاط' }, metal_die: { ar: 'قالب معدني' }, various: { ar: 'حسب المنتج' },
};
export const FINISHES: Record<string, { ar: string; separation?: boolean }> = {
  matte_lam: { ar: 'سلوفان مطفي' }, gloss_lam: { ar: 'سلوفان لامع' }, soft_touch: { ar: 'سوفت تاتش' }, spot_uv: { ar: 'Spot UV', separation: true }, gold_foil: { ar: 'فويل ذهبي', separation: true },
  silver_foil: { ar: 'فويل فضي', separation: true }, emboss: { ar: 'بارز (Emboss)', separation: true }, deboss: { ar: 'غائر (Deboss)', separation: true }, round_corners: { ar: 'زوايا دائرية' },
  numbering: { ar: 'ترقيم' }, perforation: { ar: 'تخريم' }, binding: { ar: 'تجليد' }, saddle_stitch: { ar: 'تدبيس' }, perfect_bind: { ar: 'تجليد حراري' }, hard_cover: { ar: 'غلاف مقوى' }, spiral: { ar: 'سلك' },
  eyelets: { ar: 'عيون معدنية' }, hemming: { ar: 'حواف مخيطة' }, laser_cut: { ar: 'قص ليزر' }, stretcher_wrap: { ar: 'شد على إطار خشبي' }, hole_punch: { ar: 'ثقب للتعليق' },
};
export const METHODS: Record<string, string> = { digital: 'طباعة ديجيتال', offset: 'أوفست', card_printer: 'طابعة بطاقات', digital_label: 'طباعة ملصقات ديجيتال', eco_solvent: 'إيكو سولفنت', uv: 'طباعة UV', sublimation: 'تسامي (Sublimation)', pigment: 'أحبار بيجمنت', dtf: 'DTF', heat_transfer: 'طباعة حرارية', screen: 'سلك سكرين', laser_engrave: 'حفر ليزر', emboss_die: 'قالب بارز', laser_cut: 'قص ليزر' };

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id);

/** What the shop really offers: disabled products / materials / finishes / methods are hidden or flagged, never assumed. */
export interface Capabilities { disabledProducts: string[]; disabledMaterials: string[]; disabledFinishes: string[]; disabledMethods: string[]; pdfx: 'none' | 'x1a' | 'x4'; iccProfile: string }
export function available(p: Product, cap: Capabilities) {
  return {
    enabled: !cap.disabledProducts.includes(p.id),
    materials: p.materials.filter((m) => !cap.disabledMaterials.includes(m)),
    finishes: p.finishes.filter((f) => !cap.disabledFinishes.includes(f)),
    methods: p.methods.filter((m) => !cap.disabledMethods.includes(m)),
  };
}

/** Minimum effective PPI for a viewing distance (eye resolves ~1 arc-minute): 300 at hand distance, far less for banners. */
export function ppiForDistance(meters: number) {
  const inches = meters * 39.37;
  const acuity = 1 / (inches * Math.tan((1 / 60) * (Math.PI / 180)));
  // ×2.5 over the acuity limit as a practical safety margin for print (clamped 50–300)
  return Math.max(50, Math.min(300, Math.round((acuity * 2.5) / 10) * 10));
}
/** the eye's own limit at a viewing distance (1 arc-minute): above this, more pixels cannot be seen */
export function acuityPpi(meters: number) { return Math.max(10, Math.round(1 / (meters * 39.37 * Math.tan((1 / 60) * (Math.PI / 180))))); }
/** the largest picture an image model returns (long side, px) */
export const AI_MAX_PX = 1536;
/** effective PPI of an image of `px` pixels printed `mm` wide */
export const effectivePpi = (px: number, mm: number) => (mm > 0 ? Math.round((px / mm) * 25.4) : 0);
/** spine thickness (mm) for perfect binding: leaves × paper caliper */
export const spineMm = (pages: number, caliperMm = 0.1) => Math.round((Math.ceil(pages / 2) * caliperMm) * 10) / 10;
