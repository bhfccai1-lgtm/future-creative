'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** On phones, long collapsible cards start folded (tap the title to open). Desktop keeps them open. */
export function CollapseOnMobile() {
  const path = usePathname();
  useEffect(() => {
    if (window.innerWidth >= 640) return;
    document.querySelectorAll<HTMLDetailsElement>('details[data-mcollapse]').forEach((d) => { if (!d.dataset.touched) d.open = false; });
  }, [path]);
  return null;
}
