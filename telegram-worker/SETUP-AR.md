# ربط موقع AlfaClass ببوت تلكرام: خطوات التركيب

الفكرة: تنشر تحضير بالموقع ← الموقع يخبر الـ Worker ← الـ Worker يرسله للقناة ولكل عضو سوّى /start للبوت.
وإذا حذفت المنشور من الموقع ← ينحذف من تلكرام.

## 1) تلكرام
- القناة: ضيف البوت **مسؤول** (صلاحية نشر الرسائل + حذف الرسائل).
- الأعضاء: لازم كل عضو يفتح البوت ويضغط **Start** مرة وحدة (تلكرام ما يسمح للبوت يراسل أحد قبل هذا).

## 2) Cloudflare Worker
1. Workers & Pages ← Create ← Create Worker ← سمّه `alfaclass-bot` ← Deploy.
2. اضغط **Edit code**، امسح كل شي، والصق محتوى ملف `worker.js`، ثم **Deploy**.
3. **KV:** Storage & Databases ← KV ← Create namespace باسم `alfaclass`.
   ثم Worker ← Settings ← Bindings ← Add ← KV namespace، واكتب Variable name: `KV` واختر الـ namespace.
4. Worker ← Settings ← **Variables and Secrets** ← Add:
   - `BOT_TOKEN` (نوع Secret): توكن البوت.
   - `WEBHOOK_SECRET` (نوع Secret): أي كلمة سر إنجليزية وأرقام بدون مسافات، مثل `AlfaClass2026bot`.
   - `CHANNEL_ID` (نوع Text): يوزر القناة مثل `@alfaclass_lectures`.
5. اضغط Deploy مرة ثانية لتثبيت الإعدادات.

## 3) ربط البوت بالـ Worker (مرة وحدة)
افتح بالمتصفح (غيّر الجزئين):
`https://alfaclass-bot.اسمك.workers.dev/register?key=كلمة_السر_WEBHOOK_SECRET`
إذا ظهر `"ok": true` يعني تم.

## 4) الموقع
- افتح `index.html`، ودوّر على `const TG_WORKER_URL = '';` وحط رابط الـ Worker بين العلامتين:
  `const TG_WORKER_URL = 'https://alfaclass-bot.اسمك.workers.dev';`
- ارفع الملفات المحدثة على GitHub.

## 5) التجربة
1. من حسابك افتح البوت واضغط Start (يرد عليك برسالة تأكيد).
2. انشر تحضير تجريبي بالموقع ← لازم يوصل للقناة ولك.
3. احذف المنشور من الموقع ← لازم يختفي من تلكرام.

## ملاحظات
- المنشورات التي تُحذف تلقائياً بنهاية اليوم (التنظيف التلقائي بالموقع) **ما تُحذف من تلكرام** حالياً.
- تعديل المنشور بالموقع لا يعدّل رسالة تلكرام.
- إذا فشل شي افتح الموقع، وفي المتصفح اضغط F12 ← Console، وابحث عن `Telegram sync`، وابعث لي النص.
