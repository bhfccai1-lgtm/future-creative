import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '../db';
import { audit } from '../audit';
import { AppError } from '../errors';
import { getSettings } from '../settings';
import { getAiProvider } from '../ai';
import { assertBudget, estimateTextCost, recordUsage } from '../ai/cost';
import { can, type Permission } from '../auth/rbac';
import { enq } from '../queue/queues';
import { runAdvisor } from '../ops/advisor';
import { accountPlans, approvePlanIdeas, planIdeasByKey } from '../growth/account-plan';

/**
 * «مساعد إبداع المستقبل» — one chat box instead of 30 pages. The owner writes in Gulf Arabic; the model plans and
 * uses TOOLS:
 *  - read tools run at once (system health, accounts, approvals, one account's plan, products) — they only read
 *  - action tools (design now, approve plan ideas) are NEVER run by the model: they come back as a PROPOSAL the
 *    owner confirms with a button; the proposal is signed (HMAC) and re-checked against the user's permissions
 * Every model call is budgeted and recorded. Without an AI key the assistant still answers the common questions
 * (status, accounts, approvals) from rules.
 */
type User = { sub: string; email: string; perms: readonly string[] };
export interface ChatTurn { role: 'user' | 'assistant'; content: string }
export interface Proposal { tool: 'design_now' | 'approve_plan_ideas'; args: Record<string, unknown>; summary: string; exp: number; sig: string }
export interface AssistantReply { reply: string; proposal: Proposal | null; used: string[]; source: 'ai' | 'rules' }

const READ_TOOLS = ['system_status', 'list_accounts', 'accounts_summary', 'account_plan', 'pending_approvals', 'find_products'] as const;
const ACTION_TOOLS: Record<Proposal['tool'], Permission> = { design_now: 'ads:create', approve_plan_ideas: 'ads:create' };
const FORMATS = ['REEL_VIDEO', 'IMAGE_FEED', 'IMAGE_SQUARE', 'IMAGE_STORY', 'IMAGE_CAROUSEL'] as const;

export const ASSISTANT_SYSTEM = [
  'You are «مساعد إبداع المستقبل», the assistant inside the FUTURE CREATIVE system of a print shop in Bahrain (branches Saar 33316319, Salmabad 34315316). It designs and publishes Instagram ads for 15 accounts, and has a print studio and an education studio.',
  'Answer in short, friendly Bahraini/Gulf Arabic. Be concrete: numbers, account names, the next step. Never invent numbers — use tools.',
  'TOOLS (call one at a time):',
  '- system_status {} → health score, the most important problems, disk space',
  '- list_accounts {} → account names and ids',
  '- accounts_summary {} → each account: posts, views, saves, skip rate, its top problem',
  '- account_plan {"account": "<name or handle>"} → what the account brain learnt (rules with sample sizes), best post, problems with fixes, idea keys',
  '- pending_approvals {} → designs waiting for approval',
  '- find_products {"query": "<word>"} → product names and ids',
  '- design_now {"account": "<name>", "idea": "<the idea in Arabic>", "format": "REEL_VIDEO|IMAGE_FEED|IMAGE_SQUARE|IMAGE_STORY|IMAGE_CAROUSEL"?, "product": "<product name>"?} → ACTION (costs one AI design): becomes a proposal the owner confirms',
  '- approve_plan_ideas {"account": "<name>", "keys": ["sequel","product_first",...]} → ACTION: puts plan ideas in the idea bank for the automatic schedule',
  'Rules: actions are only PROPOSED — say clearly that nothing happens until the owner presses «تأكيد». Never publish, never change settings or keys, never promise prices. If a request needs a page, name the page.',
  'Reply with JSON only: {"tool": null | {"name": "...", "args": {...}}, "reply": "<Arabic text for the owner>"}. When you call a tool, "reply" may be empty; you will receive the tool result and answer after it.',
].join('\n');

// ── signing: a proposal can only be executed as it was shown, by the user it was shown to, within 15 minutes ──
const secret = () => process.env.SESSION_SECRET ?? '';
const signOf = (userId: string, tool: string, args: unknown, exp: number) => createHmac('sha256', secret()).update(JSON.stringify([userId, tool, args, exp])).digest('base64url');
function propose(user: User, tool: Proposal['tool'], args: Record<string, unknown>, summary: string): Proposal {
  const exp = Date.now() + 15 * 60_000;
  return { tool, args, summary, exp, sig: signOf(user.sub, tool, args, exp) };
}
export function verifyProposal(user: User, p: Proposal) {
  if (!p?.sig || !p.exp || p.exp < Date.now()) throw new AppError('EXPIRED', 'انتهت صلاحية الاقتراح — اطلبه من المساعد مرة ثانية.', 410);
  const want = Buffer.from(signOf(user.sub, p.tool, p.args, p.exp)), got = Buffer.from(p.sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new AppError('BAD_PROPOSAL', 'اقتراح غير صالح.', 400);
  const perm = ACTION_TOOLS[p.tool];
  if (!perm || !can(user.perms, perm)) throw new AppError('FORBIDDEN', 'لا تملك صلاحية هذا الإجراء.', 403);
}

async function findAccount(name: unknown) {
  const q = String(name ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!q) return null;
  const all = await prisma.socialAccount.findMany({ select: { id: true, name: true, handle: true, language: true } });
  return all.find((a) => a.name.toLowerCase() === q || a.handle?.toLowerCase() === q) ?? all.find((a) => a.name.toLowerCase().includes(q) || a.handle?.toLowerCase().includes(q)) ?? null;
}

/** read tools — they only read, so they run immediately */
export async function runReadTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'system_status': {
      const r = await runAdvisor();
      return { score: r.score, grade: r.grade, top: r.advice.slice(0, 5).map((a) => ({ severity: a.severity, title: a.title, evidence: a.evidence, fix: a.steps?.[0] })) };
    }
    case 'list_accounts': return (await prisma.socialAccount.findMany({ select: { id: true, name: true, handle: true, language: true, paused: true } }));
    case 'accounts_summary': return (await accountPlans({ days: 30 })).map((p) => ({ account: p.account.name, posts: p.measured, views: p.totals.views, saves: p.totals.saves, skip: p.totals.skip, topProblem: p.issues[0]?.text ?? null }));
    case 'account_plan': {
      const acc = await findAccount(args.account);
      if (!acc) return { error: 'account not found', hint: 'call list_accounts' };
      const [p] = await accountPlans({ accountId: acc.id, days: 30 });
      return { account: acc.name, learnt: p.brain?.rules.map((r) => r.ar) ?? [], top: p.top && { hook: p.top.hook, views: p.top.views, reason: p.top.reason }, issues: p.issues.map((i) => ({ text: i.text, fix: i.fix })), ideas: p.ideas.map((i) => ({ key: i.key, title: i.title, idea: i.idea, inBank: i.inBank })) };
    }
    case 'pending_approvals': {
      const ads = await prisma.advertisement.findMany({ where: { state: 'QUALITY_REVIEW' }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, headline: true, format: true, account: { select: { name: true } } } });
      return { count: await prisma.advertisement.count({ where: { state: 'QUALITY_REVIEW' } }), latest: ads.map((a) => ({ account: a.account.name, headline: a.headline, format: a.format })) };
    }
    case 'find_products': {
      const q = String(args.query ?? '').trim();
      return prisma.product.findMany({ where: { active: true, ...(q ? { OR: [{ titleAr: { contains: q } }, { titleEn: { contains: q, mode: 'insensitive' } }] } : {}) }, take: 10, select: { id: true, titleAr: true, titleEn: true } });
    }
    default: return { error: `unknown tool ${name}` };
  }
}

/** action tools become a signed proposal (validated now, executed only after «تأكيد») */
async function proposalFor(user: User, name: string, args: Record<string, unknown>): Promise<Proposal | { error: string }> {
  if (!(name in ACTION_TOOLS)) return { error: 'unknown action' };
  if (!can(user.perms, ACTION_TOOLS[name as Proposal['tool']])) return { error: 'no permission' };
  const acc = await findAccount(args.account);
  if (!acc) return { error: 'account not found' };
  if (name === 'design_now') {
    const idea = String(args.idea ?? '').trim().slice(0, 400);
    if (idea.length < 6) return { error: 'idea missing' };
    const format = FORMATS.includes(args.format as never) ? (args.format as string) : undefined;
    let productId: string | undefined, productName = '';
    if (args.product) { const pr = await prisma.product.findFirst({ where: { active: true, OR: [{ titleAr: { contains: String(args.product) } }, { titleEn: { contains: String(args.product), mode: 'insensitive' } }] } }); if (pr) { productId = pr.id; productName = pr.titleAr; } }
    const fmt: Record<string, string> = { REEL_VIDEO: 'ريل', IMAGE_FEED: 'منشور', IMAGE_SQUARE: 'مربع', IMAGE_STORY: 'ستوري', IMAGE_CAROUSEL: 'كاروسيل' };
    return propose(user, 'design_now', { accountId: acc.id, idea, ...(format ? { format } : {}), ...(productId ? { productId } : {}) },
      `تصميم ${format ? fmt[format] : 'بالصيغة المناسبة'} لحساب ${acc.name}${productName ? ` (${productName})` : ''}: «${idea}» — تكلفة تصميم واحد، ويذهب لطابور الموافقات.`);
  }
  const keys = Array.isArray(args.keys) ? (args.keys as unknown[]).map(String).slice(0, 10) : [];
  if (!keys.length) return { error: 'keys missing (use account_plan first)' };
  const ideas = await planIdeasByKey(acc.id, keys).catch(() => []);
  if (!ideas.length) return { error: 'no such idea keys' };
  return propose(user, 'approve_plan_ideas', { accountId: acc.id, keys: ideas.map((i) => i.key) }, `اعتماد ${ideas.length} أفكار لحساب ${acc.name} في بنك الأفكار: ${ideas.map((i) => i.title).join('، ')} — الجدول الآلي يصممها في مواعيده.`);
}

/** «تأكيد»: runs a verified proposal */
export async function executeProposal(user: User, p: Proposal) {
  verifyProposal(user, p);
  const a = p.args as { accountId: string; idea?: string; format?: string; productId?: string; keys?: string[] };
  if (p.tool === 'design_now') {
    await enq.generate({ accountId: a.accountId, productId: a.productId, format: a.format as never, createdBy: user.email, direction: { idea: a.idea } }, `assistant-${p.sig.slice(0, 16)}`);
    await audit({ actorId: user.sub, actorLabel: user.email, action: 'assistant.design', targetType: 'social_account', targetId: a.accountId, details: { idea: a.idea ?? '', format: a.format ?? null } });
    return { message: 'بدأ التصميم ✓ — ستجده في طابور الموافقات خلال دقيقة أو اثنتين.' };
  }
  const r = await approvePlanIdeas(a.accountId, await planIdeasByKey(a.accountId, a.keys ?? []), user);
  return { message: `اعتُمدت ${r.ids.length} أفكار في بنك الأفكار ✓ — الجدول الآلي يصممها تباعًا.` };
}

/** without an AI key: the common questions are answered from rules (free) */
async function rules(text: string): Promise<AssistantReply> {
  if (/حال|وضع النظام|تشخيص|صحة|القرص|مساحة|status/i.test(text)) {
    const r = await runReadTool('system_status', {}) as { score: number; grade: string; top: { title: string; evidence: string }[] };
    return { reply: `صحة النظام ${r.score}/100 (${r.grade}).\n${r.top.slice(0, 3).map((x) => `• ${x.title} — ${x.evidence}`).join('\n') || 'لا مشاكل مهمة ✓'}`, proposal: null, used: ['system_status'], source: 'rules' };
  }
  if (/موافق|طابور|approval/i.test(text)) {
    const r = await runReadTool('pending_approvals', {}) as { count: number; latest: { account: string; headline: string | null }[] };
    return { reply: `في الطابور ${r.count} تصميم بانتظار موافقتك.${r.latest.length ? `\n${r.latest.slice(0, 5).map((x) => `• ${x.account}: ${x.headline ?? ''}`).join('\n')}` : ''}`, proposal: null, used: ['pending_approvals'], source: 'rules' };
  }
  if (/حساب|حسابات|account/i.test(text)) {
    const r = await runReadTool('accounts_summary', {}) as { account: string; views: number; topProblem: string | null }[];
    return { reply: `آخر ٣٠ يوم:\n${[...r].sort((a, b) => b.views - a.views).slice(0, 8).map((x) => `• ${x.account}: ${x.views} مشاهدة${x.topProblem ? ` — ${x.topProblem}` : ''}`).join('\n')}\nالتفاصيل في صفحة «خطة الحسابات».`, proposal: null, used: ['accounts_summary'], source: 'rules' };
  }
  return { reply: 'أقدر أجاوبك الحين عن: حالة النظام، طابور الموافقات، ووضع الحسابات. للطلبات الأذكى (مثل «صمم ريل لحساب الأكواب عن العيد الوطني») يحتاج المساعد مفتاح OpenAI من إعدادات الذكاء الاصطناعي.', proposal: null, used: [], source: 'rules' };
}

export async function chat(user: User, history: ChatTurn[], message: string): Promise<AssistantReply> {
  const text = message.trim().slice(0, 1500);
  if (!text) throw new AppError('EMPTY', 'اكتب سؤالك.', 422);
  const s = await getSettings();
  const provider = await getAiProvider(s).catch(() => null);
  if (!provider || provider.isDryRun || !provider.generateJson) return rules(text);
  const transcript = [...history.slice(-8), { role: 'user' as const, content: text }];
  const steps: { tool: string; args: unknown; result: unknown }[] = [];
  const used: string[] = [];
  for (let step = 0; step < 4; step++) {
    await assertBudget(s, estimateTextCost(s, 3000, 500));
    const userMsg = JSON.stringify({ conversation: transcript, tool_results: steps.map((x) => ({ tool: x.tool, args: x.args, result: JSON.stringify(x.result).slice(0, 4000) })) });
    const r = await provider.generateJson(ASSISTANT_SYSTEM, userMsg, s.ai.textModel);
    await recordUsage({ provider: provider.name, model: r.model, kind: 'text', inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: estimateTextCost(s, r.usage.inputTokens, r.usage.outputTokens) });
    const out = (r.json ?? {}) as { tool?: { name?: string; args?: Record<string, unknown> } | null; reply?: string };
    const name = out.tool?.name, args = out.tool?.args ?? {};
    if (!name) return { reply: String(out.reply ?? '').slice(0, 3000) || 'تمام.', proposal: null, used, source: 'ai' };
    used.push(name);
    if ((READ_TOOLS as readonly string[]).includes(name)) { steps.push({ tool: name, args, result: await runReadTool(name, args).catch((e) => ({ error: (e as Error).message })) }); continue; }
    const p = await proposalFor(user, name, args);
    if ('error' in p) { steps.push({ tool: name, args, result: p }); continue; }
    return { reply: String(out.reply ?? '').slice(0, 2000) || 'جهزت لك الطلب — اضغط «تأكيد» لتنفيذه.', proposal: p, used, source: 'ai' };
  }
  return { reply: 'ما قدرت أكمل الطلب بخطوات قليلة — جرب تكتبه بشكل أوضح أو استخدم الصفحة المناسبة.', proposal: null, used, source: 'ai' };
}
