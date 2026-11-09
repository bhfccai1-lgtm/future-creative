import { requirePageUser } from '@/lib/auth/server';
import { getSettings, secretStatus } from '@/lib/settings';
import { estimateAdCost, monthToDateSpend } from '@/lib/ai/cost';
import { Card, PageHeader, Stat } from '@/components/ui';
import { AiSettingsForm } from '@/components/ai-settings-form';

export default async function AiSettingsPage() {
  await requirePageUser('settings:ai');
  const s = await getSettings();
  const [key, spend] = await Promise.all([secretStatus('OPENAI_API_KEY'), monthToDateSpend()]);
  return (
    <>
      <PageHeader title="إعدادات الذكاء الاصطناعي" subtitle="واجهة OpenAI API تُحاسب حسب الاستخدام وهي منفصلة عن اشتراك ChatGPT — ليست مجانية." />
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="حالة المفتاح" value={key.configured ? 'مضبوط' : 'غير مضبوط'} tone={key.configured ? 'green' : 'red'} />
        <Stat label="الإنفاق هذا الشهر" value={<span className="ltr">${spend.toFixed(3)}</span>} />
        <Stat label="الميزانية الشهرية" value={<span className="ltr">${s.ai.monthlyBudgetUsd}</span>} tone="gold" />
        <Stat label="التكلفة التقديرية لكل إعلان" value={<span className="ltr">${estimateAdCost(s).toFixed(3)}</span>} hint="موجز نصي + صورة مشهد واحدة" />
      </div>
      <Card><AiSettingsForm ai={s.ai} keyStatus={key} /></Card>
    </>
  );
}
