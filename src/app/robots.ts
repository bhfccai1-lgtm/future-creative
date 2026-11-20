import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/seo/catalog';

/** search engines may read the public product pages only — never the dashboard, the API or private links */
export const dynamic = 'force-dynamic';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/p/'], disallow: ['/', '/api/', '/proof/', '/q/', '/print-job/'] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
