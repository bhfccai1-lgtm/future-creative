import { getBusiness, locationsOf } from '../business';
import { getSettings } from '../settings';

export interface WaNumber { label: string; phone: string; accountIds: string[]; showOnProductPage: boolean; inCatalog: boolean }

/** «33316319» → «97333316319»; «+966 5x…» / «00966…» → digits with the country code. null = invalid. */
export function normalizeWaPhone(v: string): string | null {
  let d = v.replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 8) d = `973${d}`; // Bahrain local number
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** «97333316319» → «33316319» (Bahraini customers know the local form); other countries keep +code */
export const displayWaPhone = (d: string) => (d.startsWith('973') && d.length === 11 ? d.slice(3) : `+${d}`);
export const waLink = (phone: string, text?: string) => `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

/** Configured numbers, or the branch phones when none are configured yet. */
export async function waNumbers(): Promise<WaNumber[]> {
  const s = await getSettings();
  if (s.whatsapp.numbers.length) return s.whatsapp.numbers;
  return locationsOf(await getBusiness()).map((l) => ({ label: `فرع ${l.nameAr}`, phone: `973${l.phone}`, accountIds: [], showOnProductPage: true, inCatalog: true }));
}

/** Numbers that apply to an account (its own numbers if any were assigned to it, else the general ones). */
export function numbersForAccount(all: WaNumber[], accountId: string): WaNumber[] {
  const own = all.filter((n) => n.accountIds.includes(accountId));
  return own.length ? own : all.filter((n) => !n.accountIds.length);
}
