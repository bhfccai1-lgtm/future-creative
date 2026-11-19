import { requirePageUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/ui';
import { AssistantChat } from '@/components/assistant-chat';

export const dynamic = 'force-dynamic';
export default async function AssistantPage() {
  await requirePageUser('dashboard:view');
  return (
    <>
      <PageHeader title="المساعد الذكي" subtitle="اكتب ما تريد باللهجة: يقرأ أرقام الحسابات وحالة النظام ويجهّز التصاميم والأفكار — أي إجراء يكلّف أو يغيّر شيئًا لا يُنفَّذ إلا بعد ضغطك «تأكيد»." />
      <AssistantChat />
    </>
  );
}
