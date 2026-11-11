import { NextResponse } from 'next/server';
import { integrationApi } from '@/lib/integrations/auth';
import { runDiagnostics } from '@/lib/ops/diagnostics';
export const dynamic = 'force-dynamic';
/** GET — system diagnostics (no secret values) for monitoring workflows. */
export const GET = integrationApi(async () => NextResponse.json(await runDiagnostics()));
