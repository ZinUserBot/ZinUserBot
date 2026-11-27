import { DRIVE_PAGE } from './drive.js';

// Telegram stores the media; this Worker stores only private file identifiers and metadata.
const SETUP_PAGE = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>فعال‌سازی ربات فضای شخصی</title><style>
body{font-family:Tahoma,sans-serif;background:#f2f4fb;color:#20243a;margin:0;display:grid;place-items:center;min-height:100vh}main{background:white;border-radius:20px;padding:32px;max-width:440px;margin:20px;box-shadow:0 8px 40px #1827591a;line-height:1.9}h1{font-size:1.35rem}label{display:block;font-weight:bold}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #aeb8d0;border-radius:10px;direction:ltr;margin:8px 0 16px}button{border:0;border-radius:10px;background:#4a47d5;color:white;padding:12px 20px;font:inherit;cursor:pointer}button:disabled{opacity:.6}#result{white-space:pre-wrap}small{color:#596078}
</style></head><body><main><h1>🎯 فعال‌سازی ربات فضای شخصی</h1>
<p>ابتدا در تنظیمات Worker دو Secret به نام‌های <b>BOT_TOKEN</b> و <b>TELEGRAM_SECRET</b> بسازید و دوباره Deploy کنید. سپس رمز TELEGRAM_SECRET را اینجا وارد کنید.</p>
<form id="setup"><label for="secret">رمز TELEGRAM_SECRET</label><input id="secret" type="password" required autocomplete="off" dir="ltr"><button type="submit">فعال‌سازی ربات</button></form>
<p id="result" role="status" aria-live="polite"></p><small>رمز فقط برای درخواست فعال‌سازی ارسال می‌شود و در صفحه ذخیره نمی‌شود. پس از موفقیت، در تلگرام /start را بزنید.</small>
</main><script>
document.getElementById('setup').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('secret');
  const button = event.currentTarget.querySelector('button');
  const result = document.getElementById('result');
  button.disabled = true; result.textContent = 'در حال فعال‌سازی…';
  try {
    const response = await fetch('/setup', {method:'POST', headers:{'X-Telegram-Bot-Api-Secret-Token':input.value}});
    if (response.ok) { const data = await response.json(); result.textContent = data.ok ? '✅ ربات فعال شد! در تلگرام /start را بزنید.' : 'فعال‌سازی ناموفق بود.'; }
    else if (response.status === 403) result.textContent = '❌ رمز اشتباه است. TELEGRAM_SECRET را بررسی کنید.';
    else if (response.status === 503) result.textContent = '❌ ابتدا BOT_TOKEN و TELEGRAM_SECRET را در Cloudflare تنظیم و Worker را مجدداً Deploy کنید.';
    else result.textContent = '❌ ارتباط با تلگرام ناموفق بود. توکن ربات و تنظیمات Worker را بررسی کنید.';
  } catch { result.textContent = '❌ ارتباط با سرور برقرار نشد. دوباره تلاش کنید.'; }
  finally { input.value = ''; button.disabled = false; }
});
</script></body></html>`;


// Validate Telegram Mini App initData on the server; never trust the user ID sent by the browser.
async function telegramUser(initData, token) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash) || params.getAll('hash').length !== 1) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const secret = await crypto.subtle.sign('HMAC', key, enc.encode(token));
  const verifyKey = await crypto.subtle.importKey('raw', secret, {name:'HMAC', hash:'SHA-256'}, false, ['verify']);
  const bytes = new Uint8Array(hash.match(/../g).map(h => parseInt(h, 16)));
  if (!await crypto.subtle.verify('HMAC', verifyKey, bytes, enc.encode(check))) return null;
  const date = Number(params.get('auth_date'));
  const now = Math.floor(Date.now()/1000);
  if (!Number.isInteger(date) || date > now + 60 || now - date > 86400) return null;
  try { const user = JSON.parse(params.get('user')); return Number.isSafeInteger(user.id) && user.id > 0 ? user.id : null; } catch { return null; }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return new Response(SETUP_PAGE, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" }
    });
    if (url.pathname === '/drive' && request.method === 'GET') return new Response(DRIVE_PAGE, {headers: { 'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' https://telegram.org; img-src blob:; media-src blob:; connect-src 'self'; base-uri 'none'" }});
    if (url.pathname === '/api/upload' && request.method === 'POST') {
      if (!env.BOT_TOKEN) return Response.json({error:'ربات تنظیم نشده است.'}, {status:503});
      const user = await telegramUser(request.headers.get('X-Telegram-Init-Data') || '', env.BOT_TOKEN);
      if (!user) return Response.json({error:'ورود نامعتبر است؛ دوباره از ربات وارد شوید.'}, {status:401});
      if (Number(request.headers.get('content-length')) > 21 * 1024 * 1024) return Response.json({error:'حجم فایل بیش از ۲۰ مگابایت است.'}, {status:413});
      try {
        const form = await request.formData(), file = form.get('file');
        if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) return Response.json({error:'فایل باید حداکثر ۲۰ مگابایت باشد.'}, {status:400});
        const internal = new FormData(); internal.append('file', file, file.name); internal.append('user', String(user));
        return env.GAME.get(env.GAME.idFromName('quiz')).fetch('https://internal/upload', {method:'POST', body:internal});
      } catch { return Response.json({error:'بارگذاری فایل ممکن نشد.'}, {status:400}); }
    }
    if (url.pathname === '/api/drive' && request.method === 'POST') {
      if (!env.BOT_TOKEN) return Response.json({error:'ربات هنوز تنظیم نشده است.'}, {status:503});
      const user = await telegramUser(request.headers.get('X-Telegram-Init-Data') || '', env.BOT_TOKEN);
      if (!user) return Response.json({error:'ورود نامعتبر یا منقضی است؛ صفحه را دوباره از داخل ربات باز کنید.'}, {status:401});
      let data;
      try { data = await request.json(); } catch { return Response.json({error:'درخواست نامعتبر است.'}, {status:400}); }
      return env.GAME.get(env.GAME.idFromName('quiz')).fetch('https://internal/drive', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user, ...{action:data.action, id:data.id}})});
    }
    if (!['/webhook', '/setup'].includes(url.pathname) || request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (!env.BOT_TOKEN || !env.TELEGRAM_SECRET) return new Response('Bot secrets are not configured', { status: 503 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_SECRET) return new Response('Forbidden', { status: 403 });
    if (url.pathname === '/setup') {
      try {
        const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: new URL('/webhook', url.origin).toString(), secret_token: env.TELEGRAM_SECRET, allowed_updates: ['message', 'callback_query'] })
        });
        const result = await response.json();
        return Response.json(result, { status: response.ok && result.ok ? 200 : 502 });
      } catch { return new Response('Could not connect to Telegram', { status: 502 }); }
    }
    return env.GAME.get(env.GAME.idFromName('quiz')).fetch(request);
  }
};

// Keep the original Durable Object class and binding so existing deployments migrate safely.
export class Game {
  constructor(state, env) { this.state = state; this.env = env; }
  async telegram(method, data) {
    const response = await fetch(`https://api.telegram.org/bot${this.env.BOT_TOKEN}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
    return result.result;
  }
  send(chat, text, extra = {}) { return this.telegram('sendMessage', { chat_id: chat, text, ...extra }); }
  prefix(user) { return `file:${user}:`; }
  async list(chat, user, cursor = '') {
    const prefix = this.prefix(user);
    const options = { prefix, limit: 7 };
    if (cursor) options.startAfter = prefix + cursor;
    const entries = [...(await this.state.storage.list(options)).entries()];
    if (!entries.length) return this.send(chat, '📂 فایلی در این صفحه نیست. عکس، ویدیو یا فایل بفرست تا ذخیره شود.');
    const shown = entries.slice(0, 6);
    const lines = shown.map(([, file], i) => `${i + 1}. ${file.type === 'photo' ? '🖼' : file.type === 'video' ? '🎬' : '📄'} ${file.name}`);
    const buttons = shown.map(([key, file], i) => {
      const id = key.slice(prefix.length);
      return [{ text: `📥 دریافت ${i + 1}`, callback_data: `f:v:${id}` }, { text: `🗑 حذف ${i + 1}`, callback_data: `f:d:${id}` }];
    });
    const navigation = [];
    if (cursor) navigation.push({ text: '⏮ اول فهرست', callback_data: 'f:l:home' });
    if (entries.length > 6) navigation.push({ text: 'صفحه بعد ⬅️', callback_data: `f:l:${shown.at(-1)[0].slice(prefix.length)}` });
    if (navigation.length) buttons.push(navigation);
    return this.send(chat, '📁 فایل‌های شخصی شما:\n\n' + lines.join('\n') + '\n\nبرای دریافت یا حذف، دکمه مربوط را بزنید.', { reply_markup: { inline_keyboard: buttons } });
  }
  async message(message, origin) {
    const user = message.from, chat = message.chat;
    if (!user || !chat) return;
    if (chat.type !== 'private' || chat.id !== user.id) return; // Never expose a personal library in a group.
    const text = (message.text || '').trim();
    const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
    if (command === '/start' || command === '/help') {
      return this.send(chat.id, 'سلام! 👋 به فضای شخصی فایل‌ها خوش آمدی.\n\nعکس، ویدیو یا فایل را همین‌جا بفرست تا در فهرست شخصی‌ات ذخیره شود.\n/drive — باز کردن فضای گرافیکی\n/files — فهرست فایل‌ها در چت\n/help — راهنما\n\nفایل‌ها در تلگرام هستند و ربات شناسه آن‌ها را نگه می‌دارد. این سرویس جایگزین نسخه پشتیبان مطمئن نیست.', { reply_markup: { inline_keyboard: [[{text:'📁 گنجینه من', web_app:{url:new URL('/drive', origin).toString()}}]] } });
    }
    if (command === '/drive') return this.send(chat.id, '✨ فضای شخصی خودت را باز کن:', { reply_markup: { inline_keyboard: [[{text:'📁 گنجینه من', web_app:{url:new URL('/drive', origin).toString()}}]] } });
    if (command === '/files') return this.list(chat.id, user.id);
    let type, media;
    if (message.photo?.length) { type = 'photo'; media = message.photo.at(-1); }
    else if (message.video) { type = 'video'; media = message.video; }
    else if (message.document) { type = 'document'; media = message.document; }
    if (!media?.file_id) return this.send(chat.id, 'برای ذخیره، عکس، ویدیو یا فایل بفرست. برای دیدن فایل‌ها /files را بزن.');
    const id = `${Date.now().toString(36)}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const fallback = type === 'photo' ? 'عکس' : type === 'video' ? 'ویدیو' : 'فایل';
    const name = (media.file_name || message.caption || fallback).replace(/[\r\n]+/g, ' ').slice(0, 80);
    await this.state.storage.put(this.prefix(user.id) + id, { type, fileId: media.file_id, name, mime: media.mime_type || '', caption: (message.caption || '').slice(0, 1024) });
    return this.send(chat.id, `✅ ${fallback} در فهرست شخصی ذخیره شد.\nبرای مشاهده: /files`);
  }
  async callback(cb) {
    const chat = cb.message?.chat, user = cb.from;
    if (!chat || !user || chat.type !== 'private' || chat.id !== user.id) {
      return this.telegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'این بخش فقط در گفتگوی خصوصی در دسترس است.', show_alert: true });
    }
    const [kind, action, id, extra] = (cb.data || '').split(':');
    if (kind !== 'f' || extra !== undefined || !id || !/^[a-z0-9-]+$/.test(id) || !['v', 'd', 'l'].includes(action)) {
      return this.telegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'درخواست نامعتبر است.' });
    }
    if (action === 'l') {
      await this.telegram('answerCallbackQuery', { callback_query_id: cb.id });
      return this.list(chat.id, user.id, id === 'home' ? '' : id);
    }
    const key = this.prefix(user.id) + id;
    const file = await this.state.storage.get(key);
    if (!file) return this.telegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'فایل پیدا نشد یا قبلاً حذف شده است.', show_alert: true });
    if (action === 'd') {
      await this.state.storage.delete(key);
      await this.telegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'از فهرست حذف شد.' });
      return this.send(chat.id, '🗑 فایل از فهرست شخصی حذف شد. پیام‌های قبلی تلگرام به‌طور خودکار حذف نمی‌شوند. /files');
    }
    await this.telegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'در حال ارسال فایل…' });
    const method = { photo: 'sendPhoto', video: 'sendVideo', document: 'sendDocument' }[file.type];
    if (!method) return this.send(chat.id, 'نوع فایل پشتیبانی نمی‌شود.');
    try { await this.telegram(method, { chat_id: chat.id, [file.type]: file.fileId, ...(file.caption ? { caption: file.caption } : {}) }); }
    catch { await this.send(chat.id, '❌ بازیابی فایل از تلگرام ممکن نشد. ممکن است فایل دیگر در دسترس نباشد.'); }
  }
  async driveApi({user, action, id}) {
    if (!Number.isSafeInteger(user) || user <= 0) return Response.json({error:'درخواست نامعتبر است.'}, {status:400});
    const prefix = this.prefix(user);
    if (action === 'list') {
      if (id && (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id))) return Response.json({error:'درخواست نامعتبر است.'}, {status:400});
      const options = {prefix, limit: 31};
      if (id) options.startAfter = prefix + id;
      const all = [...(await this.state.storage.list(options)).entries()];
      const shown = all.slice(0, 30);
      return Response.json({items:shown.map(([key, value]) => ({id:key.slice(prefix.length), name:value.name, type:value.type, mime:value.mime || ''})), next:all.length > 30 ? shown.at(-1)[0].slice(prefix.length) : null});
    }
    if (!['get', 'delete', 'preview'].includes(action) || typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return Response.json({error:'درخواست نامعتبر است.'}, {status:400});
    const key = prefix + id, file = await this.state.storage.get(key);
    if (!file) return Response.json({error:'فایل پیدا نشد.'}, {status:404});
    if (action === 'delete') { await this.state.storage.delete(key); return Response.json({ok:true}); }
    if (action === 'preview') {
      const mime = file.type === 'photo' ? 'image/jpeg' : file.type === 'video' ? 'video/mp4' : file.mime;
      if (!['image/jpeg','image/png','image/webp','image/gif','video/mp4'].includes(mime)) return Response.json({error:'پیش‌نمایش این نوع فایل پشتیبانی نمی‌شود.'}, {status:400});
      try {
        const info = await this.telegram('getFile', {file_id:file.fileId});
        if (!info?.file_path || (info.file_size && info.file_size > 20 * 1024 * 1024)) throw new Error('unavailable');
        const media = await fetch(`https://api.telegram.org/file/bot${this.env.BOT_TOKEN}/${info.file_path}`);
        if (!media.ok || !media.body) throw new Error('unavailable');
        return new Response(media.body, {headers: {'Content-Type':mime, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff'}});
      } catch { return Response.json({error:'پیش‌نمایش عکس در دسترس نیست.'}, {status:502}); }
    }
    const method = {photo:'sendPhoto', video:'sendVideo', document:'sendDocument'}[file.type];
    if (!method) return Response.json({error:'نوع فایل پشتیبانی نمی‌شود.'}, {status:400});
    try { await this.telegram(method, {chat_id:user, [file.type]:file.fileId, ...(file.caption ? {caption:file.caption} : {})}); return Response.json({ok:true}); }
    catch { return Response.json({error:'بازیابی فایل از تلگرام ممکن نشد.'}, {status:502}); }
  }
  async upload(request) {
    const form = await request.formData(), user = Number(form.get('user')), file = form.get('file');
    if (!Number.isSafeInteger(user) || user <= 0 || !(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024) return Response.json({error:'فایل نامعتبر است.'}, {status:400});
    const data = new FormData(); data.append('chat_id', String(user)); data.append('document', file, file.name || 'file');
    try {
      const response = await fetch(`https://api.telegram.org/bot${this.env.BOT_TOKEN}/sendDocument`, {method:'POST', body:data});
      const result = await response.json();
      if (!response.ok || !result.ok || !result.result?.document?.file_id) throw new Error('upload failed');
      const doc = result.result.document;
      const id = `${Date.now().toString(36)}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
      const name = (doc.file_name || file.name || 'فایل').replace(/[\r\n]+/g, ' ').slice(0,80);
      await this.state.storage.put(this.prefix(user) + id, {type:'document', fileId:doc.file_id, name, mime:doc.mime_type || file.type || '', caption:''});
      return Response.json({ok:true});
    } catch { return Response.json({error:'ارسال به تلگرام ناموفق بود. دوباره تلاش کنید.'}, {status:502}); }
  }
  async fetch(request) {
    try {
      if (new URL(request.url).pathname === '/upload') return await this.state.blockConcurrencyWhile(() => this.upload(request));
      const update = await request.json();
      if (new URL(request.url).pathname === '/drive') {
        if (['list', 'preview', 'get'].includes(update.action)) return await this.driveApi(update);
        return await this.state.blockConcurrencyWhile(() => this.driveApi(update));
      }
      await this.state.blockConcurrencyWhile(async () => {
        if (update.callback_query) await this.callback(update.callback_query);
        else if (update.message) await this.message(update.message, new URL(request.url).origin);
      });
      return new Response('OK');
    } catch (error) { console.error('Update failed:', error.message); return new Response('Error', { status: 500 }); }
  }
}
