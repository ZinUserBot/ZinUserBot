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


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return new Response(SETUP_PAGE, {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" }
    });
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
  async message(message) {
    const user = message.from, chat = message.chat;
    if (!user || !chat) return;
    if (chat.type !== 'private' || chat.id !== user.id) return; // Never expose a personal library in a group.
    const text = (message.text || '').trim();
    const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
    if (command === '/start' || command === '/help') {
      return this.send(chat.id, 'سلام! 👋 به فضای شخصی فایل‌ها خوش آمدی.\n\nعکس، ویدیو یا فایل را همین‌جا بفرست تا در فهرست شخصی‌ات ذخیره شود.\n/files — مشاهده و دریافت یا حذف فایل‌ها\n/help — راهنما\n\nفایل‌ها در تلگرام هستند و ربات شناسه آن‌ها را نگه می‌دارد. این سرویس جایگزین نسخه پشتیبان مطمئن نیست.');
    }
    if (command === '/files') return this.list(chat.id, user.id);
    let type, media;
    if (message.photo?.length) { type = 'photo'; media = message.photo.at(-1); }
    else if (message.video) { type = 'video'; media = message.video; }
    else if (message.document) { type = 'document'; media = message.document; }
    if (!media?.file_id) return this.send(chat.id, 'برای ذخیره، عکس، ویدیو یا فایل بفرست. برای دیدن فایل‌ها /files را بزن.');
    const id = `${Date.now().toString(36)}-${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    const fallback = type === 'photo' ? 'عکس' : type === 'video' ? 'ویدیو' : 'فایل';
    const name = (media.file_name || message.caption || fallback).replace(/[\r\n]+/g, ' ').slice(0, 80);
    await this.state.storage.put(this.prefix(user.id) + id, { type, fileId: media.file_id, name, caption: (message.caption || '').slice(0, 1024) });
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
  async fetch(request) {
    try {
      const update = await request.json();
      await this.state.blockConcurrencyWhile(async () => {
        if (update.callback_query) await this.callback(update.callback_query);
        else if (update.message) await this.message(update.message);
      });
      return new Response('OK');
    } catch (error) { console.error('Update failed:', error.message); return new Response('Error', { status: 500 }); }
  }
}
