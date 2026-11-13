import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as React from 'react';

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));

export const buttonVariants = cva('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50', {
  variants: {
    variant: {
      primary: 'bg-navy-800 text-white hover:bg-navy-700',
      gold: 'bg-gold-500 text-navy-900 hover:bg-gold-400',
      outline: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
      danger: 'bg-red-600 text-white hover:bg-red-700',
      success: 'bg-emerald-600 text-white hover:bg-emerald-700',
      ghost: 'text-slate-700 hover:bg-slate-100',
    },
    size: { sm: 'px-3 py-2.5 text-xs sm:py-1.5', md: '', lg: 'px-6 py-3 text-base' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
});

export function Button({ className, variant, size, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...p} />;
}

export function Card({ className, title, actions, children, collapsible }: { className?: string; title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; collapsible?: boolean }) {
  if (collapsible && title) {
    // open on desktop; <CollapseOnMobile/> folds it on phones (tap the title to open)
    return (
      <details open data-mcollapse className={cn('card group min-w-0 overflow-x-auto p-4 sm:p-5', className)}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <h2 className="text-base font-extrabold text-navy-900">{title}</h2>
          <span className="flex items-center gap-2">{actions}<span className="text-slate-400 transition group-open:rotate-180" aria-hidden>▾</span></span>
        </summary>
        <div className="mt-4">{children}</div>
      </details>
    );
  }
  return (
    <section className={cn('card min-w-0 overflow-x-auto p-4 sm:p-5', className)}>
      {(title || actions) && <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-extrabold text-navy-900">{title}</h2>{actions}</div>}
      {children}
    </section>
  );
}

const tones = {
  slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800', blue: 'bg-sky-100 text-sky-800', gold: 'bg-gold-300/40 text-navy-900', navy: 'bg-navy-800 text-white',
};
export function Badge({ tone = 'slate', children, className }: { tone?: keyof typeof tones; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold', tones[tone], className)}>{children}</span>;
}

export function Stat({ label, value, hint, tone = 'navy' }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'navy' | 'gold' | 'red' | 'green' }) {
  const ring = { navy: 'border-r-navy-700', gold: 'border-r-gold-500', red: 'border-r-red-500', green: 'border-r-emerald-500' }[tone];
  return (
    <div className={cn('card border-r-4 p-4', ring)}>
      <div className="text-xs font-bold text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-navy-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6 sm:gap-4">
      <div><h1 className="text-xl font-extrabold text-navy-900 sm:text-2xl">{title}</h1>{subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}
