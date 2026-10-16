# -*- coding: utf-8 -*-
# تعديل: جعل "إلغاء التصويت" بوابة تغيير الخيار — حتى في الاستفتاء المقفل
import io, sys

path = r'c:\Users\ALMUSTAFA\Desktop\مشاريع المواقع\AlfaClass-main\index.html'
with io.open(path, 'r', encoding='utf-8', newline='') as f:
    raw = f.read()

crlf = '\r\n' in raw
text = raw.replace('\r\n', '\n')
steps = 0

def fail(msg):
    print('FAIL:', msg)
    sys.exit(1)

def rep(old, new, label, expect=1):
    global text, steps
    n = text.count(old)
    if n != expect:
        fail('%s: found %d (expected %d)' % (label, n, expect))
    text = text.replace(old, new)
    steps += 1
    print('ok  -', label)

# حماية: لا نطبّق مرتين
if 'هو بوابة العودة للتصويت' in text:
    print('SKIP: التعديلات مطبَّقة مسبقاً')
    sys.exit(0)

# R1: السحب مسموح حتى بالمقفل (إلغاء التصويت بوابة العودة)
rep("        if (isLock) throw new Error('locked');",
    "        // إلغاء التصويت مسموح حتى في الاستفتاء المقفل — هو بوابة العودة للتصويت بخيار آخر",
    'R1: withdraw allowed when locked')

# R2: رسالة رفض التغيير المباشر تشير لزر الإلغاء
rep("    if (msg === 'locked') { showToast('ℹ️', 'استفتاء', 'هذا الاستفتاء مقفل — لا يمكن التصويت أو السحب'); return; }",
    "    if (msg === 'locked') { showToast('ℹ️', 'استفتاء', 'لا يمكن تغيير الاختيار مباشرة — اضغط «إلغاء التصويت» بجانب اسمك ثم أعد التصويت'); return; }",
    'R2: locked toast guides to cancel button')

# R3: زر الإلغاء يظهر دائماً لصوتي (حتى بالقفل)
rep('''      // السحب مسموح إن لم يُقفل الاستفتاء ولدي صلاحية التصويت (الزر يظهر لصوتي أنا فقط داخل الدالة)
      const canWithdraw = !lock && (!currentUser || userHasPerm(currentUser, 'vote'));''',
    '''      // زر الإلغاء يظهر دائماً لصوتي (حتى بالقفل) — هو بوابة تغيير الخيار: إلغاء ثم تصويت جديد
      const canWithdraw = !currentUser || userHasPerm(currentUser, 'vote');''',
    'R3: cancel button always visible for own vote')

# R4: المقفل يسمح بالنقر على خياري أنا فقط (للسحب) — يغطي حتى حالة إخفاء قائمة المصوتين
rep("""    const clickable = canAct ? ` onclick="event.stopPropagation(); votePoll('${escJS(r.id)}', ${i}, '${escJS(coll)}')"` : '';""",
    """    const clickable = (canAct || isMyVote) ? ` onclick="event.stopPropagation(); votePoll('${escJS(r.id)}', ${i}, '${escJS(coll)}')"` : ''; // المقفل: خياري أنا فقط للسحب""",
    'R4: own bar clickable for withdraw when locked')

# R5: نص الإرشاد بعد التصويت بالقفل يشير لبوابة الإلغاء
rep("""    : (lock ? '✓ تم تصويتك — شكراً لك' : '✓ صوتك مسجّل — يمكنك تغيير صوتك باختيار خيار آخر');""",
    """    : (lock ? '✓ تم تصويتك — لتغيير خيارك: اضغط «إلغاء التصويت» بجانب اسمك أو خيارك نفسه ثم اختر خياراً آخر' : '✓ صوتك مسجّل — يمكنك تغيير صوتك باختيار خيار آخر');""",
    'R5: locked meta hint points to cancel')

# R6: عنوان خيار القفل يعكس معناه الجديد (مكانان)
rep('لا يمكن إعادة الاختيار أو إعادة التصويت',
    'لا تغيير مباشر — التغيير عبر «إلغاء التصويت» ثم التصويت مجدداً',
    'R6: lock checkbox labels', expect=2)

# R7: شرح الواجهة (مكانان)
rep('ويمكن سحب الصوت بالضغط على نفس الخيار ما لم يُفعّل خيار المنع.',
    'ويمكن سحب الصوت بالضغط على نفس الخيار أو بزر «إلغاء التصويت» بجانب اسم المصوت — حتى إذا كان الاستفتاء مقفولاً.',
    'R7: att-hint texts', expect=2)

# كتابة الملف
out = text.replace('\n', '\r\n') if crlf else text
with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(out)
print('DONE: %d edits applied' % steps)
