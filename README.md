# ربات بازی دانستنی‌ها برای Cloudflare Workers 🎯

ربات تلگرام با سؤال‌های چهارگزینه‌ای فارسی، امتیاز و جدول برترین‌ها. بازی‌ها و امتیازها در Durable Object ذخیره می‌شوند؛ برای اجرا به سرور دائمی یا long polling نیاز نیست.

## استقرار در Cloudflare

1. این مخزن را در GitHub خود قرار دهید و از داشبورد Cloudflare، بخش **Workers & Pages** یک Worker متصل به مخزن بسازید. تنظیمات پروژه از `wrangler.jsonc` خوانده می‌شود. در تنظیمات build، دستور `npm install` و دستور deploy را `npx wrangler deploy` قرار دهید. مسیر ریشه پروژه را خالی یا `/` بگذارید. Durable Objects باید در حساب Cloudflare شما در دسترس باشد.
2. در تنظیمات Worker، بخش **Variables and Secrets**، دو secret تعریف کنید و مجدداً deploy کنید:
   - `BOT_TOKEN`: توکن ربات از BotFather.
   - `TELEGRAM_SECRET`: یک رشته تصادفی محرمانه، ۱ تا ۲۵۶ کاراکتر شامل فقط حروف انگلیسی، عدد، `_` یا `-`.
3. پس از استقرار، آدرس Worker را از داشبورد بردارید و فقط یک بار دستور زیر را اجرا کنید تا خود Worker وب‌هوک تلگرام را ثبت کند. در این دستور نیازی به وارد کردن توکن ربات نیست:

```bash
read -rs -p 'Telegram secret: ' TELEGRAM_SECRET; echo
WORKER_URL='https://YOUR-WORKER.workers.dev'
curl -sS -X POST "${WORKER_URL}/setup" \
  -H "X-Telegram-Bot-Api-Secret-Token: ${TELEGRAM_SECRET}"
unset TELEGRAM_SECRET
```

پاسخ باید `"ok":true` باشد. سپس به ربات پیام دهید و `/start` را بزنید. پس از تغییر secret، توکن یا آدرس Worker، این مرحله را دوباره اجرا کنید. فقط یک webhook برای هر ربات وجود دارد؛ از اجرای همزمان نسخه long polling خودداری کنید. آدرس `GET /` برای بررسی فعال بودن Worker است.

### رفع خطای پیدا نشدن فایل‌های استاتیک

اگر خطای `Could not detect a directory containing static files` می‌بینید، پروژه را به‌صورت **Cloudflare Pages** ساخته‌اید یا دستور استقرار Pages اجرا شده است. این مخزن سایت استاتیک نیست و به دلیل استفاده از Durable Objects باید به‌صورت **Worker** مستقر شود؛ ساخت پوشه HTML یا تنظیم output directory مشکل را حل نمی‌کند.

در داشبورد **Workers & Pages → Create application → Worker → Connect to Git** یک Worker جدید بسازید و شاخه `arena/e6cf13e7-zinuserbot` را انتخاب کنید. تنظیمات build را به این شکل قرار دهید:

- Build command: `npm install`
- Deploy command: `npx wrangler deploy`
- Root directory: ریشه مخزن (خالی یا `/`)

از `wrangler pages deploy` استفاده نکنید. اگر پروژه فعلی از نوع Pages است، یک Worker جدید بسازید؛ تغییر دستور build به‌تنهایی نوع پروژه را عوض نمی‌کند. بعد از deploy، secretها و webhook را طبق مراحل بالا تنظیم کنید.

### دستورات بازی

`/play` شروع بازی؛ `/score` امتیاز من؛ `/top` جدول سراسری؛ `/cancel` لغو؛ `/help` راهنما. هر بازی ۵ سؤال دارد و با پایان آن امتیاز ثبت می‌شود. شروع مجدد بازی قبلی همان کاربر در همان گفتگو را جایگزین می‌کند. در گروه پیام‌ها و امتیازها برای اعضا قابل مشاهده‌اند. سؤال‌ها در `src/index.js` تعریف شده‌اند و گزینه اول هر سؤال پاسخ درست است.

### استقرار از خط فرمان

با Node.js نسخه ۲۰ یا جدیدتر:

```bash
npm install
npx wrangler login
npx wrangler secret put BOT_TOKEN
npx wrangler secret put TELEGRAM_SECRET
npm run deploy
```

سپس webhook را طبق مرحله ۳ ثبت کنید. هزینه‌ها و محدودیت‌های Workers و Durable Objects به طرح Cloudflare شما بستگی دارد.

## تست

```bash
npm test
```
