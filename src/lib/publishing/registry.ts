import { getSecret, getSettings } from '../settings';
import { safeMetricoolBase } from './metricool';
import { ConfigurationError } from '../errors';
import { MetricoolAdapter } from './metricool';
import type { PublishingAdapter } from './types';

let override: PublishingAdapter | null = null;
/** Test hook only. Production resolves real adapters from encrypted configuration. */
export function setPublishingAdapterOverride(a: PublishingAdapter | null) { override = a; }

export async function getAdapter(provider: string): Promise<PublishingAdapter> {
  if (override) return override;
  if (provider !== 'metricool') throw new ConfigurationError(`مزود النشر "${provider}" غير مدعوم حاليًا. استخدم Metricool.`);
  const s = await getSettings();
  const token = await getSecret('METRICOOL_API_TOKEN');
  const userId = s.metricool.userId || process.env.METRICOOL_USER_ID || '';
  if (!token || !userId) throw new ConfigurationError('بيانات Metricool غير مكتملة (الرمز ورقم المستخدم). أكملها من إعدادات الربط.');
  return new MetricoolAdapter({ token, userId, baseUrl: safeMetricoolBase(s.metricool.baseUrl || process.env.METRICOOL_BASE_URL) });
}
