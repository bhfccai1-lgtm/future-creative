import json, uuid, os, hashlib
OUT=os.path.dirname(os.path.abspath(__file__))  # run: python3 deploy/n8n/generate_templates.py
def wid(name): return hashlib.sha1(name.encode()).hexdigest()[:16]
ERR_NAME='FC — Error alerts (any workflow failed)'
def node(name, type_, ver, pos, params, creds=None, extra=None):
    n={'parameters':params,'id':str(uuid.uuid5(uuid.NAMESPACE_URL,name+type_)),'name':name,'type':type_,'typeVersion':ver,'position':pos}
    if creds: n['credentials']=creds
    if extra: n.update(extra)
    return n
def chain(*names): return {a:{'main':[[{'node':b,'type':'main','index':0}]]} for a,b in zip(names,names[1:])}
def wf(name, nodes, connections, error=True):
    st={'executionOrder':'v1','timezone':'Asia/Bahrain','saveDataSuccessExecution':'none','saveDataErrorExecution':'all'}
    if error: st['errorWorkflow']=wid(ERR_NAME)
    return {'id':wid(name),'name':name,'nodes':nodes,'connections':connections,'active':False,'settings':st,'tags':[]}

TG = r"""const tg = async (method, body) => this.helpers.httpRequest({ method: 'POST', url: `${$env.TELEGRAM_API_BASE || 'https://api.telegram.org'}/bot${$env.TELEGRAM_BOT_TOKEN}/${method}`, body, json: true });"""
FC = r"""const fc = async (method, path, body, idem) => this.helpers.httpRequest({ method, url: `${$env.FC_API_BASE}/api/integrations/n8n${path}`, headers: { Authorization: `Bearer ${$env.FC_API_TOKEN}`, ...(idem ? { 'Idempotency-Key': idem } : {}) }, body, json: true, ignoreHttpStatusErrors: true, returnFullResponse: true });"""

VERIFY = r"""// 1) HMAC signature check  2) replay window (5 min)  3) de-duplicate by delivery id (redeliveries/retries)
const crypto = require('crypto');
const secret = $env.FC_WEBHOOK_SECRET;
if (!secret) throw new Error('FC_WEBHOOK_SECRET is not set in the n8n environment');
const seen = $getWorkflowStaticData('global');
seen.ids = seen.ids || [];
const out = [];
for (const item of $input.all()) {
  const h = item.json.headers || {};
  const ts = h['x-fc-timestamp'];
  const sig = h['x-fc-signature'] || '';
  const body = JSON.stringify(item.json.body);
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok) throw new Error('Invalid signature — event rejected');
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new Error('Stale event (replay protection)');
  const id = h['x-fc-delivery'];
  if (id && seen.ids.includes(id)) continue; // already handled
  if (id) { seen.ids.push(id); if (seen.ids.length > 500) seen.ids = seen.ids.slice(-500); }
  out.push({ json: { ...item.json.body, deliveryId: id } });
}
return out;"""

FORMAT = r"""// Arabic Telegram message for every Future Creative event (photo + approve/reject buttons for new designs).
const e = $input.first().json;
const d = e.data || {};
const base = e.dashboard || '';
const link = (p) => (p ? base + p : base);
const abs = (u) => (u && !u.startsWith('http') ? base + u : u);
let text = `🔔 ${e.title}\n`;
let photo = null, buttons = null;
switch (e.event) {
  case 'ad.ready_for_review':
    text += `الحساب: ${d.account?.name ?? ''}\nالصيغة: ${d.format}${d.slideUrls?.length ? ` (${d.slideUrls.length + 1} شرائح)` : ''}\nالعنوان: ${d.headline ?? ''}\n${d.dryRun ? '⚠️ معاينة تجريبية — غير قابلة للنشر\n' : ''}${d.qcPassed ? '✅ اجتاز فحص الجودة' : '❌ لم يجتز فحص الجودة'}${d.requiresHuman ? ' · يحتاج نظرتك' : ''}\n\n${(d.caption || '').slice(0, 600)}\n\nمراجعة: ${link(d.reviewUrl)}`;
    photo = abs(d.imageUrl);
    if (d.qcPassed && !d.dryRun) buttons = { inline_keyboard: [[{ text: '✅ اعتماد', callback_data: `a:${d.adId}` }, { text: '❌ رفض', callback_data: `r:${d.adId}` }]] };
    break;
  case 'ad.approved': text += `بواسطة: ${d.by}`; break;
  case 'ad.rejected': text += `بواسطة: ${d.by}${d.note ? `\nالسبب: ${d.note}` : ''}`; break;
  case 'publication.published': text += `الحساب: ${d.account}\n${d.publicUrl ? 'الرابط: ' + d.publicUrl : ''}`; break;
  case 'publication.scheduled': text += `الحساب: ${d.account}\nموعد النشر: ${d.publishAt}`; break;
  case 'publication.failed': text += `الحساب: ${d.account ?? d.accountId}\nالسبب: ${d.reason}\n${link('/posts?state=FAILED')}`; break;
  case 'publication.unknown': text += `الحساب: ${d.account}\n${d.error}\nتحقق في Metricool ثم قرر من: ${link('/posts?state=UNKNOWN')}`; break;
  case 'connection.lost': text += `الحساب: ${d.account}\n${d.reason}\nأعد الربط ثم «فحص كل الحسابات الآن».`; break;
  case 'approvals.reminder': text += `${d.totalPending} تصميم ينتظر منذ أكثر من ${d.hours} ساعات:\n` + (d.items || []).map((i) => `• ${i.account}: ${i.headline ?? ''} — ${link(i.reviewUrl)}`).join('\n'); break;
  case 'daily.digest':
    text += `📅 ${d.date}\nتصاميم جديدة: ${d.created} · بانتظار موافقتك: ${d.pendingApprovals}\nمؤكدة النشر اليوم: ${d.publishedVerified} · مجدولة: ${d.scheduledToday}\nفاشلة: ${d.failed} · غير مؤكدة: ${d.unknown}\nإنفاق الذكاء الاصطناعي اليوم: $${d.aiSpendUsd}\n` + ((d.upcoming || []).length ? `\nالقادم:\n` + d.upcoming.map((u) => `• ${u.at} — ${u.account}: ${u.headline ?? ''}`).join('\n') : '') + `\n\n${link(d.approvalsUrl)}`;
    break;
  case 'system.alert': text = `${d.level === 'CRITICAL' ? '🚨' : d.level === 'ERROR' ? '🔴' : d.level === 'WARNING' ? '🟡' : 'ℹ️'} ${d.title}\n${d.message}\n(${d.code})`; break;
  case 'report.weekly': {
    const m = d.metrics || {};
    text += `منشورات مؤكدة: ${m.posts ?? 0} · بمقاييس: ${m.withMetrics ?? 0}\nالوصول: ${m.reach ?? 0} · المشاهدات: ${m.views ?? 0}\nالحفظ+المشاركة: ${(m.saves ?? 0) + (m.shares ?? 0)} · متوسط التفاعل: ${m.avgEngagement ?? '—'}%\n${m.reelSkipRatePct != null ? `تخطي الريلز: ${m.reelSkipRatePct}%\n` : ''}\nالتوصيات:\n• ${(d.recommendations || []).slice(0, 5).join('\n• ')}\n\n${link('/reports')}`;
    break;
  }
  case 'test.ping': text = `✅ الربط بين مطبعة إبداع المستقبل و n8n يعمل.\n${d.message ?? ''}`; break;
  default: text += JSON.stringify(d).slice(0, 800);
}
return [{ json: { text: text.slice(0, photo ? 1000 : 4000), photo, buttons } }];"""

SEND = TG + r"""
// Sends to Telegram (token and chat from the n8n environment). Falls back to text if the photo cannot be fetched.
const { text, photo, buttons } = $input.first().json;
if (!$env.TELEGRAM_BOT_TOKEN || !$env.TELEGRAM_CHAT_ID) throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env');
const chat_id = $env.TELEGRAM_CHAT_ID;
let res;
if (photo) {
  try { res = await tg('sendPhoto', { chat_id, photo, caption: text, reply_markup: buttons || undefined }); }
  catch (err) { res = await tg('sendMessage', { chat_id, text: `${text}\n\n(تعذر إرفاق الصورة)`, reply_markup: buttons || undefined, disable_web_page_preview: true }); }
} else res = await tg('sendMessage', { chat_id, text, reply_markup: buttons || undefined, disable_web_page_preview: true });
return [{ json: { ok: !!res.ok } }];"""

BOT = TG + "\n" + FC + r"""
// Telegram bot: approve/reject buttons + commands. Only users in TELEGRAM_ALLOWED_USER_IDS may act.
const u = $input.first().json;
const allowed = ($env.TELEGRAM_ALLOWED_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const from = u.callback_query?.from || u.message?.from;
const chat_id = u.callback_query?.message?.chat?.id ?? u.message?.chat?.id;
if (!from || !chat_id) return [];
const who = from.username || String(from.id);
const say = (text) => tg('sendMessage', { chat_id, text: text.slice(0, 4000), disable_web_page_preview: true });
if (!allowed.includes(String(from.id))) {
  if (u.callback_query) await tg('answerCallbackQuery', { callback_query_id: u.callback_query.id, text: 'غير مصرح لك', show_alert: true });
  return [{ json: { ignored: 'not allowed', user: from.id } }];
}
const msg = (r) => (r.body && (r.body.message || r.body.error)) || `HTTP ${r.statusCode}`;

// ── buttons ──
if (u.callback_query) {
  const [kind, adId] = String(u.callback_query.data || '').split(':');
  if (!adId || !['a', 'r'].includes(kind)) return [];
  const decision = kind === 'a' ? 'approve' : 'reject';
  const r = await fc('POST', `/ads/${adId}/decision`, { decision, by: who }, `tg-${u.callback_query.id}`);
  const text = r.statusCode === 200 ? `تم ✓ الحالة الآن: ${r.body.state}` : `تعذر: ${msg(r)}`;
  await tg('answerCallbackQuery', { callback_query_id: u.callback_query.id, text, show_alert: true });
  if (r.statusCode === 200) await tg('editMessageReplyMarkup', { chat_id, message_id: u.callback_query.message.message_id, reply_markup: { inline_keyboard: [[{ text: decision === 'approve' ? `✅ اعتمده ${who}` : `❌ رفضه ${who}`, callback_data: 'done' }]] } }).catch(() => null);
  return [{ json: { decision, adId, status: r.statusCode } }];
}

// ── commands ──
const [cmd, ...args] = String(u.message.text || '').trim().split(/\s+/);
const findAccount = async (q) => {
  const r = await fc('GET', '/accounts');
  const list = Array.isArray(r.body) ? r.body : [];
  const k = String(q || '').replace(/^@/, '').toLowerCase();
  return list.find((a) => (a.handle || '').toLowerCase() === k || a.name.toLowerCase() === k);
};
switch (cmd) {
  case '/pending': {
    const r = await fc('GET', '/ads?state=QUALITY_REVIEW&limit=10');
    const ads = Array.isArray(r.body) ? r.body : [];
    if (!ads.length) { await say('لا توجد تصاميم بانتظار الموافقة ✅'); break; }
    for (const a of ads.slice(0, 5)) {
      const buttons = a.qc !== 'REJECTED' && !a.dryRun ? { inline_keyboard: [[{ text: '✅ اعتماد', callback_data: `a:${a.id}` }, { text: '❌ رفض', callback_data: `r:${a.id}` }]] } : undefined;
      const caption = `${a.account} · ${a.format}\n${a.headline ?? ''}\nفحص الجودة: ${a.qc}`;
      if (a.imageUrl) await tg('sendPhoto', { chat_id, photo: a.imageUrl, caption, reply_markup: buttons }).catch(() => say(caption));
      else await say(caption);
    }
    if (ads.length > 5) await say(`و${ads.length - 5} تصاميم أخرى في لوحة التحكم.`);
    break;
  }
  case '/status': {
    const r = await fc('GET', '/diagnostics');
    const d = r.body || {};
    const bad = (d.checks || []).filter((c) => c.status !== 'OK');
    await say(`🩺 الحالة العامة: ${d.overall}\n` + (bad.length ? bad.map((c) => `${c.status === 'FAIL' ? '🔴' : '🟡'} ${c.label}: ${c.detail}`).join('\n') : 'كل الفحوص سليمة ✅'));
    break;
  }
  case '/report': {
    const r = await fc('GET', `/reports?period=${args[0] === 'month' ? 'month' : 'week'}`);
    const m = r.body?.metrics || {};
    await say(`📊 تقرير ${args[0] === 'month' ? 'الشهر' : 'الأسبوع'}\nمنشورات مؤكدة: ${m.posts ?? 0}\nالوصول: ${m.reach ?? 0} · المشاهدات: ${m.views ?? 0}\nمتوسط التفاعل: ${m.avgEngagement ?? '—'}%\n\n• ${(r.body?.recommendations || []).slice(0, 4).join('\n• ')}`);
    break;
  }
  case '/pause': case '/resume': {
    const acc = await findAccount(args[0]);
    if (!acc) { await say(`لم أجد الحساب «${args[0] ?? ''}». استخدم المعرّف مثل: ${cmd} bhfcc.mugs`); break; }
    const reason = args.slice(1).join(' ') || undefined;
    const r = await fc('POST', `/accounts/${acc.id}/pause`, { paused: cmd === '/pause', by: who, reason }, `tg-${u.message.message_id}`);
    await say(r.statusCode === 200 ? `${cmd === '/pause' ? '⏸ تم إيقاف' : '▶️ تم استئناف'} ${acc.name}` : `تعذر: ${msg(r)}`);
    break;
  }
  default:
    await say('الأوامر:\n/pending — التصاميم المنتظرة مع أزرار الاعتماد\n/status — تشخيص النظام\n/report [week|month] — التقرير\n/pause <الحساب> [السبب] — إيقاف طارئ\n/resume <الحساب> — استئناف');
}
return [{ json: { command: cmd, by: who } }];"""

HEALTH = r"""// Alert only when something needs attention: failing checks or critical/high advisor recommendations.
const d = $input.first().json;
const bad = (d.checks || []).filter((c) => c.status !== 'OK');
const top = ((d.advisor && d.advisor.advice) || []).filter((a) => a.severity === 'critical' || a.severity === 'high').slice(0, 4);
if (!bad.length && !top.length) return [];
let text = `🩺 تشخيص النظام: ${d.overall}` + (d.advisor ? ` · درجة الصحة ${d.advisor.score}/100 (${d.advisor.grade})` : '') + '\n';
text += bad.map((c) => `${c.status === 'FAIL' ? '🔴' : '🟡'} ${c.label}: ${c.detail}`).join('\n');
if (top.length) text += '\n\n🧭 أولويات اليوم:\n' + top.map((a, i) => `${i + 1}. ${a.title}\n   ${a.evidence}\n   ← ${a.steps[0]}`).join('\n');
return [{ json: { text: text.slice(0, 4000), photo: null, buttons: null } }];"""

PICK = r"""// Google Sheet columns: handle | idea | format | occasion | contentType | status
// Takes up to 3 rows whose status is empty; the row number is the idempotency key, so a retry never creates a duplicate design.
const rows = $input.all().map((i) => i.json).filter((r) => !String(r.status || '').trim() && String(r.handle || '').trim() && String(r.idea || '').trim());
return rows.slice(0, 3).map((r) => ({ json: {
  row_number: r.row_number,
  idem: `sheet-${$workflow.id}-${r.row_number}-${String(r.idea).slice(0, 40)}`,
  request: { handle: String(r.handle).trim(), format: r.format || undefined, direction: { idea: String(r.idea).slice(0, 500), occasion: r.occasion || undefined, contentType: r.contentType || undefined } },
} }));"""

ERRFMT = r"""const e = $input.first().json;
const wfName = e.workflow?.name ?? 'workflow';
const node = e.execution?.lastNodeExecuted ?? e.trigger?.error?.node?.name ?? '';
const err = e.execution?.error?.message ?? e.trigger?.error?.message ?? 'unknown error';
const url = e.execution?.url ? `\n${e.execution.url}` : '';
return [{ json: { text: `🛑 فشل Workflow في n8n\n${wfName}${node ? ` — العقدة: ${node}` : ''}\n${String(err).slice(0, 600)}${url}`, photo: null, buttons: null } }];"""

http_env = lambda name,pos,method,path,body=None: node(name,'n8n-nodes-base.httpRequest',4.2,pos,{
  'method':method,'url':'={{ $env.FC_API_BASE }}/api/integrations/n8n'+path,
  'sendHeaders':True,'headerParameters':{'parameters':[{'name':'Authorization','value':'=Bearer {{ $env.FC_API_TOKEN }}'}]+([{'name':'Idempotency-Key','value':'={{ $json.idem }}'}] if body else [])},
  **({'sendBody':True,'specifyBody':'json','jsonBody':body} if body else {}),'options':{}})

w1 = wf('FC — Events → Telegram', [
  node('Future Creative events','n8n-nodes-base.webhook',2,[0,0],{'httpMethod':'POST','path':'future-creative','responseMode':'onReceived','options':{}},extra={'webhookId':str(uuid.uuid5(uuid.NAMESPACE_URL,'fc-events'))}),
  node('Verify & de-duplicate','n8n-nodes-base.code',2,[240,0],{'jsCode':VERIFY}),
  node('Format message','n8n-nodes-base.code',2,[480,0],{'jsCode':FORMAT}),
  node('Send to Telegram','n8n-nodes-base.code',2,[720,0],{'jsCode':SEND}),
], chain('Future Creative events','Verify & de-duplicate','Format message','Send to Telegram'))

w2 = wf('FC — Telegram bot (buttons + commands)', [
  node('Telegram updates','n8n-nodes-base.telegramTrigger',1.1,[0,0],{'updates':['callback_query','message'],'additionalFields':{}},creds={'telegramApi':{'id':'','name':'Telegram FC bot'}},extra={'webhookId':str(uuid.uuid5(uuid.NAMESPACE_URL,'fc-tg'))}),
  node('Bot logic','n8n-nodes-base.code',2,[260,0],{'jsCode':BOT}),
], chain('Telegram updates','Bot logic'))

w3 = wf('FC — Morning health check', [
  node('Every day 08:15','n8n-nodes-base.scheduleTrigger',1.2,[0,0],{'rule':{'interval':[{'field':'days','triggerAtHour':8,'triggerAtMinute':15}]}}),
  http_env('Get diagnostics',[240,0],'GET','/diagnostics'),
  node('Only problems','n8n-nodes-base.code',2,[480,0],{'jsCode':HEALTH}),
  node('Send to Telegram','n8n-nodes-base.code',2,[720,0],{'jsCode':SEND}),
], chain('Every day 08:15','Get diagnostics','Only problems','Send to Telegram'))

w4 = wf('FC — Ideas sheet → designs', [
  node('Every hour','n8n-nodes-base.scheduleTrigger',1.2,[0,0],{'rule':{'interval':[{'field':'hours','hoursInterval':1}]}}),
  node('Read ideas sheet','n8n-nodes-base.googleSheets',4.5,[240,0],{'documentId':{'__rl':True,'mode':'url','value':''},'sheetName':{'__rl':True,'mode':'name','value':'ideas'},'options':{}},creds={'googleSheetsOAuth2Api':{'id':'','name':'Google Sheets'}}),
  node('New rows only','n8n-nodes-base.code',2,[480,0],{'jsCode':PICK}),
  http_env('Request design',[720,0],'POST','/generate','={{ JSON.stringify($json.request) }}'),
  node('Mark row queued','n8n-nodes-base.googleSheets',4.5,[960,0],{'operation':'update','documentId':{'__rl':True,'mode':'url','value':''},'sheetName':{'__rl':True,'mode':'name','value':'ideas'},
     'columns':{'mappingMode':'defineBelow','value':{'row_number':"={{ $('New rows only').item.json.row_number }}",'status':'=queued {{ $json.jobId }}'},'matchingColumns':['row_number']},'options':{}},creds={'googleSheetsOAuth2Api':{'id':'','name':'Google Sheets'}}),
], chain('Every hour','Read ideas sheet','New rows only','Request design','Mark row queued'))

w5 = wf(ERR_NAME, [
  node('On workflow error','n8n-nodes-base.errorTrigger',1,[0,0],{}),
  node('Format error','n8n-nodes-base.code',2,[240,0],{'jsCode':ERRFMT}),
  node('Send to Telegram','n8n-nodes-base.code',2,[480,0],{'jsCode':SEND}),
], chain('On workflow error','Format error','Send to Telegram'), error=False)


ARCHIVE_NAME = 'FC — Archive published posts to Google Drive & Sheets'
FETCH = FC + r"""
// Downloads the exact published files (signed links from the system) as binary items for Google Drive.
const e = $input.first().json;
const adId = e.data && e.data.adId;
if (!adId) return [];
const r = await fc('GET', `/ads/${adId}`);
if (r.statusCode !== 200) throw new Error(`Future Creative API ${r.statusCode}`);
const ad = r.body;
const day = String(e.occurredAt || new Date().toISOString()).slice(0, 10);
const safe = (x) => String(x || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
const out = [];
for (const [i, m] of (ad.media || []).entries()) {
  const ext = /\.mp4($|\?)/.test(m.url) ? 'mp4' : 'jpg';
  const buf = await this.helpers.httpRequest({ method: 'GET', url: m.url, encoding: 'arraybuffer', json: false });
  const fileName = `${day} ${safe(ad.account)} — ${safe(ad.headline)}${ad.media.length > 1 ? ` (${i + 1})` : ''}.${ext}`;
  const binary = await this.helpers.prepareBinaryData(Buffer.from(buf), fileName, ext === 'mp4' ? 'video/mp4' : 'image/jpeg');
  out.push({ json: { adId, fileName, account: ad.account, headline: ad.headline, format: ad.format, publicUrl: ad.publication && ad.publication.publicUrl, publishedAt: day }, binary: { data: binary } });
}
return out;"""
ROW = r"""// One log row per post (first file's Drive link)
const first = $input.first().json;
const src = $('Fetch published files').first().json;
return [{ json: { date: src.publishedAt, account: src.account, format: src.format, headline: src.headline, instagram: src.publicUrl || '', drive: first.webViewLink || first.id || '', adId: src.adId } }];"""
ONLY_PUB = r"""return $input.all().filter((i) => i.json.event === 'publication.published');"""

w6 = wf(ARCHIVE_NAME, [
  node('From events router','n8n-nodes-base.executeWorkflowTrigger',1.1,[0,0],{'inputSource':'passthrough'}),
  node('Fetch published files','n8n-nodes-base.code',2,[240,0],{'jsCode':FETCH}),
  node('Upload to Google Drive','n8n-nodes-base.googleDrive',3,[480,0],{'name':'={{ $json.fileName }}','driveId':{'__rl':True,'mode':'list','value':'My Drive'},'folderId':{'__rl':True,'mode':'id','value':'={{ $env.GDRIVE_FOLDER_ID }}'},'options':{}},creds={'googleDriveOAuth2Api':{'id':'','name':'Google Drive'}}),
  node('Log row','n8n-nodes-base.code',2,[720,0],{'jsCode':ROW}),
  node('Append to Google Sheet','n8n-nodes-base.googleSheets',4.5,[960,0],{'operation':'append','documentId':{'__rl':True,'mode':'url','value':''},'sheetName':{'__rl':True,'mode':'name','value':'published'},'columns':{'mappingMode':'autoMapInputData','value':{}},'options':{}},creds={'googleSheetsOAuth2Api':{'id':'','name':'Google Sheets'}}),
], chain('From events router','Fetch published files','Upload to Google Drive','Log row','Append to Google Sheet'))

# events router: also hand verified publications to the archive sub-workflow (fire-and-forget)
w1['nodes'].append(node('Only published','n8n-nodes-base.code',2,[480,200],{'jsCode':ONLY_PUB}))
w1['nodes'].append(node('Archive to Google','n8n-nodes-base.executeWorkflow',1.2,[720,200],{'workflowId':{'__rl':True,'value':wid(ARCHIVE_NAME),'mode':'id'},'options':{'waitForSubWorkflow':False}}))
w1['connections']['Verify & de-duplicate'] = {'main':[[{'node':'Format message','type':'main','index':0},{'node':'Only published','type':'main','index':0}]]}
w1['connections']['Only published'] = {'main':[[{'node':'Archive to Google','type':'main','index':0}]]}

for f in os.listdir(OUT):
    if f.endswith('.json'): os.remove(os.path.join(OUT,f))
for fn,w in [('01-events-to-telegram.json',w1),('02-telegram-bot.json',w2),('03-morning-health-check.json',w3),('04-ideas-sheet-to-designs.json',w4),('05-error-alerts.json',w5),('06-archive-to-google-drive-sheets.json',w6)]:
    json.dump(w, open(os.path.join(OUT,fn),'w'), ensure_ascii=False, indent=2)
print('ok', [w['id'] for w in (w1,w2,w3,w4,w5)])
