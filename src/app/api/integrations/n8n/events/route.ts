import { NextResponse } from 'next/server';
import { integrationApi } from '@/lib/integrations/auth';
import { EVENTS } from '@/lib/integrations/events';
/** GET — catalogue of events this system emits (for building n8n switches). */
export const GET = integrationApi(async (_req, { settings }) => NextResponse.json({ subscribed: settings.n8n.events, available: EVENTS }));
