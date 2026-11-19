import { describe, expect, it } from 'vitest';
import { landmarkDetail, plannedSlots } from '@/lib/edu/art';
import { SettingsSchema, type EduContent } from '@/lib/edu/types';

const content = (gallery: { caption: string; image?: string }[]) => ({
  title: 'وطني', intro: '', sections: [{ id: 's1', heading: 'بعض معالم مملكة البحرين', body: '', bullets: [], examples: [], exercises: [], gallery }],
}) as unknown as EduContent;

describe('EDUCATION MASTER art direction', () => {
  it('known Bahrain landmarks are described accurately', () => {
    expect(landmarkDetail('مركز البحرين التجاري العالمي')).toMatch(/three sky bridges.*wind turbine/);
    expect(landmarkDetail('قلعة البحرين')).toMatch(/stone fort/);
    expect(landmarkDetail('شجرة الحياة')).toMatch(/alone/);
    expect(landmarkDetail('قلم رصاص')).toBeNull();
  });
  it('glossy brochure: cover with a Bahraini student, gallery as realistic photos with landmark details, one shared art bible', () => {
    const s = SettingsSchema.parse({ type: 'brochure', subject: 'اللغة العربية', grade: 'الصف الرابع', lesson: 'وطني', style: 'glossy', images: 'medium', coverCharacter: 'boy' });
    const slots = plannedSlots(s, content([{ caption: 'قلعة البحرين' }, { caption: 'مركز البحرين التجاري العالمي' }]));
    const cover = slots.find((x) => x.id === 'cover')!;
    expect(cover.prompt).toMatch(/Bahraini schoolboy about 9 years old.*ghutra/);
    expect(cover.prompt).toMatch(/bottom 18 %/);
    const gal = slots.filter((x) => x.kind === 'gallery');
    expect(gal).toHaveLength(2);
    expect(gal[0].prompt).toMatch(/realistic, high-quality travel-brochure photograph/);
    expect(gal[1].prompt).toMatch(/wind turbine/);
    for (const x of slots) { expect(x.prompt).toMatch(/Consistent art direction/); expect(x.prompt).toMatch(/ABSOLUTELY NO text/); }
  });
  it('Islamic studies never get a character; illustration galleries keep the brochure style', () => {
    const s = SettingsSchema.parse({ type: 'brochure', subject: 'التربية الإسلامية', grade: 'الصف الرابع', lesson: 'أركان الإيمان', style: 'glossy', images: 'medium', coverCharacter: 'girl', galleryStyle: 'illustration' });
    const slots = plannedSlots(s, content([{ caption: 'مسجد' }]));
    expect(slots.find((x) => x.id === 'cover')!.prompt).not.toMatch(/schoolgirl/);
    expect(slots.find((x) => x.kind === 'gallery')!.prompt).not.toMatch(/photograph/);
  });
});
