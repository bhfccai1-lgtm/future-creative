'use client';
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="rounded-lg bg-[#e6c25a] px-3 py-1.5 text-sm font-bold text-[#0b1730]">🖨️ طباعة / PDF</button>;
}
