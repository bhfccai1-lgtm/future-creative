import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { api } from '@/lib/auth/server';
import { setSecret } from '@/lib/settings';
import { audit } from '@/lib/audit';

const Body = z.object({ kind: z.enum(['secret', 'token']) });
/**
 * Generates a new signing secret / API token on the server and returns it ONCE so the admin can paste it
 * into an n8n credential. It is stored encrypted and never shown again (rotate to replace).
 */
export const POST = api('settings:integrations', async (req, { user }) => {
  const { kind } = Body.parse(await req.json());
  const value = (kind === 'token' ? 'fcn8n_' : 'fcwhs_') + randomBytes(32).toString('base64url');
  await setSecret(kind === 'token' ? 'N8N_API_TOKEN' : 'N8N_WEBHOOK_SECRET', value, user.email);
  await audit({ actorId: user.sub, actorLabel: user.email, action: `settings.n8n.rotate_${kind}` });
  return NextResponse.json({ kind, value, note: 'انسخه الآن — لن يظهر مرة أخرى.' });
});
