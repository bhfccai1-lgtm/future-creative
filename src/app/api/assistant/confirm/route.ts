import { NextResponse } from 'next/server';
import { z } from 'zod';
import { api } from '@/lib/auth/server';
import { executeProposal, type Proposal } from '@/lib/assistant/agent';

/** «تأكيد»: runs a proposal exactly as the assistant showed it (signed, 15 minutes, permissions re-checked) */
const Body = z.object({ proposal: z.object({ tool: z.enum(['design_now', 'approve_plan_ideas']), args: z.record(z.string(), z.unknown()), summary: z.string().max(600), exp: z.number(), sig: z.string().max(100) }) });
export const POST = api('dashboard:view', async (req, { user }) => NextResponse.json(await executeProposal(user, Body.parse(await req.json()).proposal as Proposal)));
