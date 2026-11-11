import { api } from '@/lib/auth/server';
import { exportProductsCsv } from '@/lib/catalog/import';
/** GET — all products as CSV (UTF-8 with BOM for Excel). Also the template for imports. */
export const GET = api('dashboard:view', async () => new Response(await exportProductsCsv(), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="future-creative-products.csv"' } }));
