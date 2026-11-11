import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { runDiagnostics } from '@/lib/ops/diagnostics';
import { runAdvisor } from '@/lib/ops/advisor';
export const dynamic = 'force-dynamic';
/** Read-only system and account diagnostics (no secret values). */
export const GET = api('dashboard:view', async () => NextResponse.json({ ...(await runDiagnostics()), advisor: await runAdvisor() }));
