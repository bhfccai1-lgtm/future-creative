import { NextResponse } from 'next/server';
import { api } from '@/lib/auth/server';
import { getSecret } from '@/lib/settings';
import { OpenAiProvider } from '@/lib/ai/openai-provider';
export const POST = api('settings:ai', async () => {
  const key = await getSecret('OPENAI_API_KEY');
  if (!key) return NextResponse.json({ ok: false, message: 'لم يتم إدخال مفتاح OpenAI.' });
  return NextResponse.json(await new OpenAiProvider(key).verify());
});
