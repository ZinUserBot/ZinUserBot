const QUESTIONS = [
  ['پایتخت ژاپن کدام شهر است؟', 'توکیو', 'سئول', 'پکن', 'بانکوک'],
  ['کدام سیاره به سیاره سرخ معروف است؟', 'مریخ', 'زهره', 'زحل', 'عطارد'],
  ['حاصل ۹ × ۷ چند است؟', '۶۳', '۵۶', '۷۲', '۶۹'],
  ['بزرگ‌ترین اقیانوس جهان کدام است؟', 'آرام', 'اطلس', 'هند', 'منجمد شمالی'],
  ['نویسنده شاهنامه کیست؟', 'فردوسی', 'سعدی', 'حافظ', 'مولوی'],
  ['نماد شیمیایی طلا چیست؟', 'Au', 'Ag', 'Fe', 'O'],
  ['کدام جانور پستاندار است؟', 'دلفین', 'کوسه', 'تمساح', 'اختاپوس'],
  ['زمین به دور کدام ستاره می‌گردد؟', 'خورشید', 'شعرای یمانی', 'ستاره قطبی', 'سهیل'],
  ['یک ساعت چند دقیقه است؟', '۶۰', '۱۰۰', '۳۰', '۹۰'],
  ['بزرگ‌ترین قاره جهان کدام است؟', 'آسیا', 'آفریقا', 'اروپا', 'آمریکای جنوبی'],
  ['آب در فشار معمولی در چند درجه سانتی‌گراد می‌جوشد؟', '۱۰۰', '۹۰', '۸۰', '۱۲۰'],
  ['کدام زبان بیشتر در برزیل صحبت می‌شود؟', 'پرتغالی', 'اسپانیایی', 'انگلیسی', 'فرانسوی'],
  ['کدام ساز کلیدهای سیاه و سفید دارد؟', 'پیانو', 'تار', 'دف', 'ویولن'],
  ['مثلث چند ضلع دارد؟', '۳', '۴', '۵', '۶'],
  ['کدام گاز برای تنفس انسان ضروری است؟', 'اکسیژن', 'هیدروژن', 'هلیوم', 'نئون'],
];
const ROUNDS = 5;
const shuffle = array => {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return new Response('ربات دانستنی‌ها فعال است.');
    if (!['/webhook', '/setup'].includes(url.pathname) || request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (!env.BOT_TOKEN || !env.TELEGRAM_SECRET) return new Response('Bot secrets are not configured', { status: 503 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_SECRET) return new Response('Forbidden', { status: 403 });
    if (url.pathname === '/setup') {
      const webhookUrl = new URL('/webhook', url.origin).toString();
      try {
        const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl, secret_token: env.TELEGRAM_SECRET, allowed_updates: ['message', 'callback_query'] })
        });
        const result = await response.json();
        return Response.json(result, { status: response.ok && result.ok ? 200 : 502 });
      } catch {
        return new Response('Could not connect to Telegram', { status: 502 });
      }
    }
    const stub = env.GAME.get(env.GAME.idFromName('quiz'));
    return stub.fetch(request);
  }
};

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
  key(chat, user) { return `game:${chat}:${user}`; }

  async ask(chat, key, game) {
    const q = QUESTIONS[game.questions[game.round]];
    const options = shuffle(q.slice(1));
    game.correct = options.indexOf(q[1]);
    game.nonce = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
    await this.state.storage.put(key, game);
    await this.send(chat, `🎯 سؤال ${game.round + 1} از ${ROUNDS}\n${q[0]}`, {
      reply_markup: { inline_keyboard: options.map((text, i) => [{ text, callback_data: `q:${game.nonce}:${i}` }]) }
    });
  }

  async message(message) {
    const chat = message.chat?.id, user = message.from;
    if (chat == null || !user || !message.text) return;
    const command = message.text.trim().split(/\s+/)[0].split('@')[0].toLowerCase();
    const key = this.key(chat, user.id);
    if (command === '/start' || command === '/help') {
      await this.send(chat, 'سلام! 👋 به مسابقه دانستنی‌ها خوش آمدید.\nدر هر بازی به ۵ سؤال پاسخ دهید و برای هر جواب درست یک امتیاز بگیرید.\n\n/play — شروع بازی\n/score — امتیاز من\n/top — جدول برترین‌ها\n/cancel — لغو بازی');
    } else if (command === '/play') {
      const game = { questions: shuffle(QUESTIONS.map((_, i) => i)).slice(0, ROUNDS), round: 0, score: 0, name: (user.first_name || 'بازیکن').slice(0, 100) };
      await this.ask(chat, key, game);
    } else if (command === '/cancel') {
      const removed = await this.state.storage.delete(key);
      await this.send(chat, removed ? 'بازی لغو شد.' : 'بازی فعالی ندارید.');
    } else if (command === '/score') {
      const player = await this.state.storage.get(`player:${user.id}`);
      await this.send(chat, player ? `⭐ امتیاز کل: ${player.score}\n🎮 بازی‌های کامل‌شده: ${player.games}` : 'هنوز بازی کاملی انجام نداده‌اید. /play');
    } else if (command === '/top') {
      const players = [...(await this.state.storage.list({ prefix: 'player:' })).values()];
      players.sort((a, b) => b.score - a.score || a.games - b.games || a.id - b.id);
      await this.send(chat, players.length ? '🏆 جدول برترین‌ها\n' + players.slice(0, 10).map((p, i) => `${i + 1}. ${p.name} — ${p.score}`).join('\n') : 'هنوز امتیازی ثبت نشده است. /play');
    }
  }

  async callback(cb) {
    const chat = cb.message?.chat?.id, user = cb.from;
    const key = this.key(chat, user?.id);
    const game = await this.state.storage.get(key);
    const parts = (cb.data || '').split(':');
    if (!game || parts.length !== 3 || parts[0] !== 'q' || parts[1] !== game.nonce || !['0', '1', '2', '3'].includes(parts[2])) {
      await this.telegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'این سؤال متعلق به شما نیست یا دیگر فعال نیست.', show_alert: true });
      return;
    }
    const correct = Number(parts[2]) === game.correct;
    const answer = QUESTIONS[game.questions[game.round]][1];
    if (correct) game.score++;
    game.round++;
    game.nonce = null;
    // Persist progress before contacting Telegram, so old buttons cannot score twice.
    if (game.round === ROUNDS) {
      const playerKey = `player:${user.id}`;
      await this.state.storage.transaction(async txn => {
        const player = await txn.get(playerKey) || { id: user.id, score: 0, games: 0 };
        player.name = game.name; player.score += game.score; player.games++;
        await txn.put(playerKey, player);
        await txn.delete(key);
      });
    } else await this.state.storage.put(key, game);
    await this.telegram('answerCallbackQuery', { callback_query_id: cb.id, text: correct ? 'آفرین! ✅' : 'پاسخ اشتباه بود ❌' });
    try { await this.telegram('editMessageReplyMarkup', { chat_id: chat, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (e) { console.error('Could not remove old keyboard', e.message); }
    await this.send(chat, correct ? '✅ درست بود!' : `❌ پاسخ درست: ${answer}`);
    if (game.round < ROUNDS) await this.ask(chat, key, game);
    else await this.send(chat, `🏁 بازی تمام شد! امتیاز شما: ${game.score} از ${ROUNDS}\nبرای بازی دوباره /play را بزنید.`);
  }

  async fetch(request) {
    try {
      const update = await request.json();
      // Serialize updates, including Telegram calls, to avoid duplicate scoring.
      await this.state.blockConcurrencyWhile(async () => {
        if (update.callback_query) await this.callback(update.callback_query);
        else if (update.message) await this.message(update.message);
      });
      return new Response('OK');
    } catch (error) {
      console.error('Update failed:', error.message);
      return new Response('Error', { status: 500 });
    }
  }
}
