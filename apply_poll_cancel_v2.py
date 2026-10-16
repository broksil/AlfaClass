# -*- coding: utf-8 -*-
# تعديل: التغيير المباشر ممنوع في كل الاستفتاءات — التغيير حصراً عبر "إلغاء التصويت"
# (استبدال بالمؤشرات ASCII لتفادي اختلاف تركيب الحروف العربية)
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

def slice_replace(start_anchor, end_anchor, new_text, label):
    global text, steps
    s = text.find(start_anchor)
    if s < 0 or text.find(start_anchor, s + 1) >= 0:
        fail('%s: start anchor not unique (%d)' % (label, text.find(start_anchor)))
    e = text.find(end_anchor, s)
    if e < 0:
        fail('%s: end anchor not found' % label)
    text = text[:s] + new_text + text[e:]
    steps += 1
    print('ok  -', label)

def line_replace(anchor, new_line, label):
    global text, steps
    i = text.find(anchor)
    if i < 0 or text.find(anchor, i + 1) >= 0:
        fail('%s: anchor not unique (%d)' % (label, i))
    s = text.rfind('\n', 0, i) + 1
    e = text.find('\n', i)
    text = text[:s] + new_line + text[e:]
    steps += 1
    print('ok  -', label)

# حماية: لا نطبّق مرتين
if 'change-needs-cancel' in text:
    print('SKIP: التعديلات مطبَّقة مسبقاً')
    sys.exit(0)

# R1: الواجهة — بعد التصويت لا تُقبل النقر على خيارات أخرى (كل الاستفتاءات)
rep("  const canAct = (!currentUser || userHasPerm(currentUser, 'vote')) && (votedIdx < 0 || !lock);",
    "  const canAct = (!currentUser || userHasPerm(currentUser, 'vote')) && votedIdx < 0; // التغيير المباشر ممنوع في كل الاستفتاءات — يمر عبر «إلغاء التصويت»",
    'R1: canAct blocks direct change everywhere')

# R2: تعليق شريط النقر
rep("""    const clickable = (canAct || isMyVote) ? ` onclick="event.stopPropagation(); votePoll('${escJS(r.id)}', ${i}, '${escJS(coll)}')"` : ''; // المقفل: خياري أنا فقط للسحب""",
    """    const clickable = (canAct || isMyVote) ? ` onclick="event.stopPropagation(); votePoll('${escJS(r.id)}', ${i}, '${escJS(coll)}')"` : ''; // بعد التصويت: خياري أنا فقط (سحب عبر الإلغاء)""",
    'R2: clickable comment updated')

# R3: وسم "هذا صوتك" بلا تمييز المقفل (استبدال بالمؤشرات)
slice_replace("    let mineTag = '';", "    const subParts",
    "    let mineTag = '';\n    if (isMyVote) {\n      mineTag = `<div class=\"pb-mine\">✓ هذا صوتك</div>`;\n    }\n",
    'R3: unified mine tag')

# R4: نص الإرشاد الموحّد قبل/بعد التصويت (استبدال بالمؤشرات)
slice_replace("  const metaTxt = votedIdx < 0", "  return `",
    "  const metaTxt = votedIdx < 0\n"
    "    ? 'اضغط على خيارك للتصويت — يمكنك تغييره لاحقاً عبر «إلغاء التصويت» بجانب اسمك'\n"
    "    : '✓ صوتك مسجّل — لتغيير خيارك اضغط «إلغاء التصويت» بجانب اسمك أو خيارك نفسه ثم اختر خياراً آخر';\n",
    'R4: unified meta hints')

# R5: المعاملة — التغيير المباشر مرفوض دائماً (وليس بالقفل فقط) — نص ASCII
rep("      if (votedIdx >= 0 && isLock) throw new Error('locked');",
    "      if (votedIdx >= 0) throw new Error('change-needs-cancel'); // التغيير المباشر ممنوع في كل الاستفتاءات — يمر عبر «إلغاء التصويت»",
    'R5: transaction rejects direct change always')

# R6: إزالة كتلة النقل الميتة (مؤشرات ASCII)
slice_replace("      if (votedIdx >= 0) {", "      options[idx].voters =",
    "",
    'R6: removed dead vote-move block')

# R7: رسالة الخطأ تُعالج الحالة الجديدة (سطر كامل بالمؤشر)
line_replace("if (msg === 'locked') {",
    "    if (msg === 'locked' || msg === 'change-needs-cancel') { showToast('ℹ️', 'استفتاء', 'التغيير المباشر غير متاح — اضغط «إلغاء التصويت» بجانب اسمك ثم اختر خياراً آخر'); return; }",
    'R7: toast for change-needs-cancel')

# R8: شرح الواجهة — استبدال نهاية الجملة بعد "بجانب اسم المصوت" (مكانان)
idxs = []
_pos = 0
while True:
    _k = text.find('بجانب اسم المصوت', _pos)
    if _k < 0:
        break
    idxs.append(_k)
    _pos = _k + 1
if len(idxs) != 2:
    fail('R8: anchor found %d times' % len(idxs))
for _k in reversed(idxs):
    _e = text.find('.', _k)
    if _e < 0:
        fail('R8: sentence end not found')
    text = text[:_k] + 'بجانب اسم المصوت — وهذا هو طريق تغيير الاختيار في كل الاستفتاءات.' + text[_e + 1:]
steps += 1
print('ok  - R8: att-hint texts')

# R9: تعليق متغيّر القفل (سطر كامل بالمؤشر)
line_replace("const lock = p.lockVote === true || p.locked === true;",
    "  const lock = p.lockVote === true || p.locked === true; // شارة المنشئ القديمة — السلوك موحّد الآن: التغيير عبر «إلغاء التصويت» في كل الحالات",
    'R9: lock comment updated')

# كتابة الملف
out = text.replace('\n', '\r\n') if crlf else text
with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(out)
print('DONE: %d edits applied' % steps)
