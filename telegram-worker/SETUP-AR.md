# دليل إعداد Worker ألفاكلاس — النسخة المحدثة

## ما الجديد في هذه النسخة؟

| الميزة | التفاصيل |
|--------|----------|
| **تنسيق HTML للرسائل** | ثلاثة قوالب مختلفة (تحضير / بلاغ عام / بلاغ أستاذ) |
| **نشر مجدول تلقائي** | تحاضير الغد تُرسل كل يوم 9:00 مساءً بتوقيت بغداد |
| **اشتراك المجموعات** | /start و/تشغيل من أي محادثة (خاصة أو مجموعة) |
| **بث شامل** | القناة الرئيسية + جميع chat_ids المحفوظة في KV |

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

### الطريقة الأولى: Dashboard (أسهل)
1. Workers & Pages → Create → Create Worker → سمّه `alfaclass-bot` → Deploy
2. اضغط Edit code، امسح الكل، والصق محتوى `worker.js` → Deploy

### الطريقة الثانية: Wrangler CLI
```bash
npm install -g wrangler
wrangler login

# عدّل wrangler.toml أولاً: ضع id الـ KV namespace الحقيقي
wrangler deploy
```

---

## 3) إعداد Cron Trigger (النشر المجدول)

### عبر wrangler.toml (موجود بالملف)
```toml
[triggers]
crons = ["0 18 * * *"]   # 18:00 UTC = 9:00 PM بغداد
```

### عبر Dashboard
Workers & Pages → Worker → Settings → Triggers → Cron Triggers → Add Cron:
```
0 18 * * *
```

---

## 4) ربط البوت (مرة وحدة)

افتح في المتصفح (غيّر الجزئين):
```
https://alfaclass-bot.اسمك.workers.dev/register?key=WEBHOOK_SECRET_هنا
```
إذا ظهر `"ok": true` في كلا الحقلين فكل شيء صحيح.

---

## 5) أوامر البوت

| الأمر | الوصف |
|-------|-------|
| `/start` أو `/تشغيل` | تفعيل الإشعارات (يحفظ chat_id في KV) |
| `/stop` | إيقاف الإشعارات (يحذف chat_id من KV) |

> **ملاحظة:** يعمل من الدردشات الخاصة والمجموعات على حد سواء.

---

## 6) أنواع الرسائل وتنسيقها

### نوع 1: تحضير يومي (`kind: 'post'`)
```
يوم الثلاثاء 5 / 11 عدنا

📚 المادة — نوع التحضير
" الملاحظة "

ألفاكلاس
```

### نوع 2: بلاغ عام (`kind: 'report'`)
```
📢 عنوان البلاغ

" التفاصيل "

ألفاكلاس
```

### نوع 3: بلاغ أستاذ / كلاس روم (`kind: 'classroom'`)
```
📚 اسم المادة
المرحلة / الدراسة / الجروب

" التفاصيل "

👩🏫 اسم الأستاذ
انقر على التفاصيل
```

### رسالة التحاضير المجمعة (Cron)
```
تحاضير يوم غد الثلاثاء 5 / 11 عدنا

📚 تقرير — الحكومية
" ملاحظات "

📚 ميد — المحاسبة المتوسطة
" ملاحظات "

ألفاكلاس
```

---

## 7) هيكل البيانات المتوقع في Firestore

### مجموعة `posts` (التحاضير)
```json
{
  "type":    "تقرير",
  "subject": "المحاسبة الحكومية",
  "note":    "نص الملاحظة",
  "date":    "2026-11-10",
  "images":  [],
  "files":   []
}
```

> **مهم:** حقل `date` بصيغة `"YYYY-MM-DD"` مطلوب للنشر المجدول.

### مجموعة `reports` (البلاغات)
```json
{
  "title":  "عنوان البلاغ",
  "body":   "نص التفاصيل",
  "author": "اسم الناشر"
}
```

---

## 8) الأسئلة الشائعة

**س: لماذا لا تصل رسالة الكرون؟**
ج: تأكد أن Cron Trigger مفعّل في Dashboard → Triggers، وراجع Logs للخطأ.

**س: كيف أتحقق من المشتركين؟**
ج: Dashboard → Workers → KV → Browse → ابحث عن المفاتيح التي تبدأ بـ `sub:`.

**س: لا تصل رسائل التحضير للمجموعة؟**
ج: تأكد أن أحد مدراء المجموعة أرسل `/start` للبوت من داخل المجموعة.
