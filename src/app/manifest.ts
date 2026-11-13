import type { MetadataRoute } from 'next';

/** Installable app («أضف إلى الشاشة الرئيسية»): opens full-screen like a phone app, straight to the dashboard. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'إبداع المستقبل — النشر الذكي',
    short_name: 'إبداع المستقبل',
    description: 'نظام النشر الإعلاني الذكي لمطبعة إبداع المستقبل',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#0b1730',
    theme_color: '#0b1730',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
