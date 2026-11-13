import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const cairo = localFont({
  src: [
    { path: './fonts/Cairo_400Regular.ttf', weight: '400' },
    { path: './fonts/Cairo_700Bold.ttf', weight: '700' },
    { path: './fonts/Cairo_800ExtraBold.ttf', weight: '800' },
  ],
  variable: '--font-cairo',
});

export const metadata: Metadata = {
  title: 'نظام إبداع المستقبل للنشر الذكي', description: 'FUTURE CREATIVE AI PUBLISHING SYSTEM',
  appleWebApp: { capable: true, title: 'إبداع المستقبل', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/apple-touch-icon.png' },
};
export const viewport: Viewport = { themeColor: '#0b1730', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable}>
      <body style={{ fontFamily: 'var(--font-cairo), system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
