# دليل إعداد Worker ألفاكلاس — النسخة المحدثة

## ما الجديد في هذه النسخة؟

| الميزة | التفاصيل |
|--------|----------|
| **تنسيق HTML للرسائل** | ثلاثة قوالب مختلفة (تحضير / بلاغ عام / بلاغ أستاذ) مع تهريب آمن للرموز |
| **نشر مجدول يومي** | تحاضير الغد تُرسل كل ليلة 9:00 مساءً بتوقيت بغداد |
| **كليشة أسبوعية (ليلة كل خميس)** | تحاضير وإمتحانات الأسبوع القادم بتنسيق اقتباسات لكل يوم ورابط البوت |
| **اشتراك المجموعات** | /start و/تشغيل من أي محادثة (خاصة أو مجموعة) واشتراك تلقائي عند إضافة البوت |
| **بث وحذف شامل آمن** | القناة الرئيسية + جميع المشتركين على دفعات آمنة لحدود Cloudflare |

---

## 1) متطلبات Cloudflare

### متغيرات البيئة
Worker → Settings → Variables and Secrets:

| الاسم | النوع | الوصف |
|-------|-------|-------|
| `BOT_TOKEN` | Secret | توكن البوت من @BotFather |
| `WEBHOOK_SECRET` | Secret | كلمة سر (أحرف/أرقام/-/_) مثال: `AlfaClass2026bot` |
| `FIREBASE_SA` | Secret | محتوى ملف JSON لـ Service Account من Firebase |
| `CHANNEL_ID` | Text | يوزر القناة مثل `@alfaclass_lectures` |
| `ALLOWED_ORIGIN` | Text | (اختياري) `https://broksil.github.io` |

### KV Namespace
1. Storage & Databases → KV → Create namespace باسم `alfaclass`
2. Worker → Settings → Bindings → Add → KV namespace
   - Variable name: `KV`
   - Namespace: اختر الـ namespace اللي أنشأته

---

## 2) رفع الـ Worker

### عبر Dashboard
1. Workers & Pages → Create → Create Worker → سمّه `alfaclass-bot` → Deploy
2. اضغط Edit code، امسح الكل، والصق محتوى `worker.js` → Deploy

---

## 3) إعداد Cron Trigger (النشر المجدول)

يعمل Cron Trigger تلقائياً في تمام الساعة **18:00 UTC** (والتي توافق **9:00 مساءً بتوقيت بغداد**):
- **كل ليلة خميس:** يرسل كليشة تحاضير وإمتحانات الأسبوع القادم مجمعة لجميع الأيام.
- **كل ليلة:** يرسل تحاضير اليوم الدراسي القادم.

إعداد الـ Cron من Dashboard:
Workers & Pages → Worker → Settings → Triggers → Cron Triggers → Add Cron:
```text
0 18 * * *
```

---

## 4) ربط البوت (مرة واحدة)

افتح في المتصفح:
```text
https://alfaclass-bot.اسمك.workers.dev/register?key=WEBHOOK_SECRET_هنا
```

---

## 5) شكل كليشة الأسبوع القادم (ليلة كل خميس)

```html
<u>تحاضير وإمتحانات الإسبوع القادم :</u>

<blockquote>• الإثنين 9 / 11</blockquote>
- الخطر : تحضير من نشأة التأمين إلىٰ تقسيمات التأمين ما داخلة.

- الحكومية : حل مثال 1 ص24
والإطلاع علىٰ موضوع سلف أفراد العاملين.

- النظام : حل أسئلة المُقاولين ص21.

<blockquote>• الثلاثاء 10 / 11</blockquote>
- المُتوسطة : مِـد (الفصل الأول) ⬇️
حساب المُتاجرة.
الأرباح والخسائر.
كشف الدخل.
الميزانية العمومية.
الأرباح المُحتجزة.

<blockquote>• الأربعاء 11 / 11</blockquote>
- الخطر : مُناقشة الواجب فقط.

<blockquote>• الخميس 12 / 11</blockquote>
- جرائم : مِـد ( من البداية الىٰ ص27 حصر السلطات الثلاث ما داخلة ).

الفاكلاس رابط http://t.me/AlfaaClassbot/ALFA
```

---

## 6) روابط الفحص اليدوي السريع

- **تجربة كليشة الأسبوع القادم يدوياً فوراً:**
  ```text
  https://alfaclass-bot.اسمك.workers.dev/trigger-weekly
  ```
- **تجربة إرسال تحاضير الغد يدوياً فوراً:**
  ```text
  https://alfaclass-bot.اسمك.workers.dev/trigger-scheduled
  ```
- **فحص الحالة والتوقيت والمشتركين:**
  ```text
  https://alfaclass-bot.اسمك.workers.dev/status
  ```
