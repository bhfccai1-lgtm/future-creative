import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getAdapter } from '@/lib/publishing/registry';
/** Real linked brands/networks as reported by the provider (nothing is assumed). */
export const GET = api('settings:integrations', async () => NextResponse.json(await (await getAdapter('metricool')).listProfiles()));
