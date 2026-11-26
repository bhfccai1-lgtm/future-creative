/**
 * SHOT RECIPES — how a specialist commercial photographer shoots each kind of print product. The lens and angle
 * used to be rotated blindly (an overhead flat-lay for a mug, a macro look for a 2 m roll-up); now the PRODUCT
 * decides the camera, the light set-up, the surface, the props and the finish, and the rotation only varies the
 * mood within what suits it. Every line is concrete photography language the image model follows well.
 */
export interface ShotRecipe {
  key: string;
  /** camera position, framing and lens — chosen for the object's size and how it is used */
  camera: string;
  /** the light SET-UP (key / fill / rim) — the mood (warm, daylight, evening) still comes from the rotation */
  light: string;
  /** what the product stands on and what is around it (Gulf / Bahrain context, never competing with the product) */
  set: string;
  /** what must read as REAL in the material (the giveaway of AI pictures is wrong material physics) */
  material: string;
  /** lens values from options.LENSES that suit this product (the rotation picks among these only) */
  lenses: string[];
  /** finishing: colour grading the retouch step applies (see photo-finish.ts) */
  grade: 'neutral' | 'warm' | 'crisp' | 'rich';
}

const R = (r: ShotRecipe) => r;

export const RECIPES: Record<string, ShotRecipe> = {
  drinkware: R({ key: 'drinkware', camera: 'eye-level three-quarter view at the height of the mug\'s print, 85–100mm lens at f/4 so the whole mug is sharp and the background melts, handle turned slightly away so the printed design faces camera',
    light: 'large softbox key from the upper left at 45°, white bounce card on the right to open the shadows, a thin strip light behind for a clean rim along the glaze',
    set: 'warm wooden or marble table, a saucer or coaster, a few coffee beans or a date bowl and a soft Gulf home interior far behind',
    material: 'glossy ceramic glaze with one clean specular highlight following the curve, the print wrapping correctly around the cylinder, steam only if natural',
    lenses: ['85mm', '50mm', 'low_hero'], grade: 'warm' }),
  apparel: R({ key: 'apparel', camera: 'straight-on front view of the garment, 50mm lens at f/5.6, the printed area large and square to camera; or worn by a person from chest to waist (face may be out of frame)',
    light: 'two large soft sources left and right for even, shadowless fabric, gentle top light to show the weave',
    set: 'neatly folded or on a wooden hanger against a clean light wall, or worn in a bright Bahrain street café',
    material: 'real cotton weave and soft natural folds, the print sitting IN the fabric (slight texture), no plastic sheen',
    lenses: ['50mm', '85mm', '35mm_context'], grade: 'crisp' }),
  'stickers-labels': R({ key: 'stickers-labels', camera: 'overhead flat-lay or a low 30° angle close-up, 100mm macro-style framing at f/8 so every sticker is sharp edge to edge',
    light: 'soft even overhead light with a low raking light from one side to reveal the cut edges and a slightly peeled corner',
    set: 'several stickers arranged with intention on a clean surface: a laptop lid, a kraft box, a water bottle — one hero sticker in front',
    material: 'thin vinyl with a precise die-cut white border, a subtle gloss or matte finish, one corner lifting to prove it is a sticker',
    lenses: ['overhead', '50mm'], grade: 'crisp' }),
  'large-format': R({ key: 'large-format', camera: 'wide environmental shot, 24–35mm lens at f/8, the banner or roll-up standing full height in its real place with a person nearby for scale',
    light: 'natural ambient light of the venue (mall atrium, exhibition hall, shop front), even across the whole print with no hot spot',
    set: 'a Bahrain mall, exhibition stand or shop entrance, softly busy background, floor reflections',
    material: 'the printed fabric/PVC taut and flat with sharp edges, the stand metal real, true large-format scale',
    lenses: ['35mm_context'], grade: 'neutral' }),
  'print-marketing': R({ key: 'print-marketing', camera: '45° elevated angle or overhead, 50mm lens at f/5.6, a fanned stack showing paper thickness',
    light: 'soft window light from one side with a gentle gradient across the paper, a slight sheen on coated stock',
    set: 'a tidy desk: a pen, a coffee cup at the edge, a plant leaf — business-like and calm',
    material: 'real paper weight and crisp trimmed edges, visible stack thickness, accurate coated or uncoated finish',
    lenses: ['50mm', 'overhead'], grade: 'crisp' }),
  gifts: R({ key: 'gifts', camera: 'three-quarter hero angle, 70–85mm lens at f/3.5, the gift slightly in front of its open box',
    light: 'warm key light with a soft glow behind and gentle sparkle in the background bokeh',
    set: 'an elegant gift box with tissue paper and a satin ribbon, warm festive Gulf interior, a card beside it',
    material: 'every gift material true to life (wood grain, metal brushing, acrylic clarity), the personalisation crisp and centred',
    lenses: ['85mm', 'low_hero', '50mm'], grade: 'rich' }),
  'signage-decor': R({ key: 'signage-decor', camera: 'straight-on or a slight three-quarter angle, 35–50mm lens at f/8, the sign mounted in its real place',
    light: 'room light plus a soft key to show depth; for acrylic, a back or edge light to reveal the clarity and polished edges',
    set: 'a modern office reception, café wall or living room in the Gulf, clean and premium',
    material: 'acrylic with polished edges and true transparency, canvas texture wrapped around a frame, standoff bolts and wall shadow',
    lenses: ['50mm', '35mm_context'], grade: 'neutral' }),
  'events-weddings': R({ key: 'events-weddings', camera: 'close three-quarter view, 85–100mm lens at f/2.8 with shallow depth of field, the invitation or board sharp, decor dissolving behind',
    light: 'soft romantic window light with warm fairy-light bokeh behind, gentle and luminous',
    set: 'fresh flowers (white roses, baby\'s breath), satin ribbon, a wax seal or gold cutlery hints, luxurious but uncluttered',
    material: 'thick textured cardstock, foil or embossing catching the light, crisp deckled or cut edges',
    lenses: ['85mm', '50mm'], grade: 'warm' }),
  education: R({ key: 'education', camera: '45° elevated angle, 50mm lens at f/5.6, the printed work flat and readable in a classroom or study setting',
    light: 'bright, clean daylight, cheerful and even, no harsh shadows',
    set: 'a school desk or classroom wall, coloured pencils, a notebook, a graduation cap for certificates',
    material: 'paper and card true to weight, laminated sheen where relevant, crisp colour',
    lenses: ['50mm', 'overhead', '35mm_context'], grade: 'crisp' }),
  corporate: R({ key: 'corporate', camera: 'elegant three-quarter overhead (60°), 50–85mm lens at f/5.6, items aligned in a branded set',
    light: 'controlled softbox light with deep but soft shadows, premium and calm',
    set: 'dark wood or stone desk, leather notebook, a premium pen — executive and minimal',
    material: 'stationery stock, rubber stamp handle and inked impression, letterhead paper texture — all precise',
    lenses: ['50mm', '85mm', 'overhead'], grade: 'rich' }),
  packaging: R({ key: 'packaging', camera: 'three-quarter hero angle slightly from above, 70mm lens at f/8 so all faces of the box are sharp, one box open to show the inside',
    light: 'softbox key with a crisp edge light to define the box corners, gentle shadow underneath',
    set: 'a clean podium or shelf, the product that goes inside beside it, premium retail feel',
    material: 'folded cardboard with true thickness at the edges, real print registration on folds, matte or soft-touch finish',
    lenses: ['low_hero', '50mm'], grade: 'neutral' }),
  default: R({ key: 'default', camera: 'three-quarter hero angle at product height, 70–85mm lens at f/4, the product fully in focus',
    light: 'large softbox key at 45° with a bounce fill and a subtle rim for separation',
    set: 'a clean premium surface with one or two relevant props, softly blurred Gulf interior behind',
    material: 'true-to-life material and print finish',
    lenses: ['85mm', '50mm', 'low_hero'], grade: 'neutral' }),
};

/** a product overrides its category recipe where the object differs (glass, transparent vinyl, canvas, roll-ups…) */
const PRODUCT_TWEAKS: Record<string, Partial<ShotRecipe>> = {
  'glass-mugs': { material: 'clear glass with true refraction and a bright edge highlight, the print sharp on the glass surface, the drink colour visible through it', light: 'backlight through the glass from behind-left plus a soft front key — glass needs light from behind to look like glass' },
  'transparent-stickers': { material: 'clear sticker on glass or a bottle: the print floating on the surface with no white border, only a faint edge sheen', set: 'a shop window or a glass jar, light passing through' },
  'roll-up-banners': { camera: 'full-height view of the roll-up standing on its base, 35mm lens at f/8, a person beside it for scale (about 2 m tall stand)' },
  'canvas-printing': { material: 'canvas weave visible up close, the image wrapping around the wooden frame edges, a soft wall shadow' },
  'rubber-stamps': { camera: 'close three-quarter view at desk level, 85mm lens at f/5.6, the stamp beside a crisp ink impression on paper', material: 'wooden or self-inking handle, a crisp ink impression with slight ink texture' },
  'business-cards': { camera: 'low 20° angle close-up, 100mm lens at f/5.6, a small fanned stack with one card leaning', material: 'thick card with clean edges, spot-UV or foil catching the light if premium' },
};

export function recipeFor(p: { slug?: string | null; categorySlug?: string | null }): ShotRecipe {
  const base = RECIPES[p.categorySlug ?? ''] ?? RECIPES.default;
  const t = p.slug ? PRODUCT_TWEAKS[p.slug] : undefined;
  return t ? { ...base, ...t, key: `${base.key}/${p.slug}` } : base;
}

/** The recipe as prompt lines (added to the scene prompt after the art direction). */
export function recipePrompt(r: ShotRecipe): string {
  return [
    `Camera (shot by a specialist product photographer): ${r.camera}.`,
    `Light set-up: ${r.light}.`,
    `Set and props: ${r.set}.`,
    `Material truth: ${r.material}.`,
  ].join('\n');
}
