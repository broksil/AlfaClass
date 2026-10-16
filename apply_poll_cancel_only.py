# -*- coding: utf-8 -*-
# تعديل: التغيير المباشر ممنوع في كل الاستفتاءات — التغيير حصراً عبر "إلغاء التصويت"
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
if 'change-needs-cancel' in text:
    print('SKIP: التعديلات مطبَّقة مسبقاً')
    sys.exit(0)

# R1: الواجهة — بعد التصويت لا تُقبل النقر على خيارات أخرى (كل الاستفتاءات)
rep('  const canAct = (!currentUser || userHasPerm(currentUser, \'vote\')) && (votedIdx < 0 || !lock);',
    '  const canAct = (!currentUser || userHasPerm(currentUser, \'vote\')) && votedIdx < 0; // التغيير المباشر ممنوع في كل الاستفتاءات — يمر عبر «إلغاء التصويت»',
    'R1: canAct blocks direct change everywhere')

# R2: تعليق شريط النقر يعكس القاعدة الجديدة
rep("""    const clickable = (canAct || isMyVote) ? ` onclick="event.stopPropagation(); votePoll('${escJS(r.id)}', ${i}, '${escJS(coll)}')"` : ''; // المقفل: خياري أنا فقط للسحب""",
    """    const clickable = (canAct || isMyVote) ? ` onclick="event.stopPropagation(); votePoll('${escJS(r.id)}', ${i}, '${escJS(coll)}')"` : ''; // بعد التصويت: خياري أنا فقط (سحب عبر الإلغاء)""",
    'R2: clickable comment updated')

# R3: وسم "هذا صوتك" بلا تمييز المقفل (السلوك موحّد)
rep("""    let mineTag = '';
    if (isMyVote) {
      if (lock) {
        mineTag = `<div class="pb-mine">✓ هذا صوتك (مُقفَّل)</div>`;
      } else {
        mineTag = `<div class="pb-mine">✓ هذا صوتك</div>`;
      }
    }""",
    """    let mineTag = '';
    if (isMyVote) {
      mineTag = `<div class="pb-mine">✓ هذا صوتك</div>`;
    }""",
    'R3: unified mine tag')

# R4: نص الإرشاد الموحّد قبل/بعد التصويت
rep("""  const metaTxt = votedIdx < 0
    ? (lock ? 'اضغط على خيارك للتصويت (مرة واحدة لكل شخص)' : 'اضغط على خيارك للتصويت — يمكنك تغيير صوتك في أي وقت')
    : (lock ? '✓ تم تصويتك — لتغيير خيارك: اضغط «إلغاء التصويت» بجانب اسمك أو خيارك نفسه ثم اختر خياراً آخر' : '✓ صوتك مسجّل — يمكنك تغيير صوتك باختيار خيار آخر');""",
    """  const metaTxt = votedIdx < 0
    ? 'اضغط على خيارك للتصويت — يمكنك تغييره لاحقاً عبر «إلغاء التصويت» بجانب اسمك'
    : '✓ صوتك مسجّل — لتغيير خيارك اضغط «إلغاء التصويت» بجانب اسمك أو خيارك نفسه ثم اختر خياراً آخر';""",
    'R4: unified meta hints')

# R5: المعاملة — التغيير المباشر مرفوض دائماً (وليس بالقفل فقط)
rep("      if (votedIdx >= 0 && isLock) throw new Error('locked');",
    "      if (votedIdx >= 0) throw new Error('change-needs-cancel'); // التغيير المباشر ممنوع في كل الاستفتاءات — يمر عبر «إلغاء التصويت»",
    'R5: transaction rejects direct change always')

# R6: إزالة كتلة النقل الميتة (لم تعد تُنفَّذ أبداً بعد R5)
rep("""      if (votedIdx >= 0) {
        // تغيير الصوت: يُنقل من الخيار القديم إلى الجديد (مع إزالة أي مفتاح قديم لي)
        options[votedIdx].voters = options[votedIdx].voters.filter(k => !myKeys.includes(voterKey(k)));
        options[votedIdx].votes = Math.max(0, options[votedIdx].votes - 1);
      }
""",
    "",
    'R6: removed dead vote-move block')

# R7: رسالة الخطأ تُعالج الحالة الجديدة
rep("    if (msg === 'locked') { showToast('ℹ️', 'استفتاء', 'لا يمكن تغيير الاختيار مباشرة — اضغط «إلغاء التصويت» بجانب اسمك ثم أعد التصويت'); return; }",
    "    if (msg === 'locked' || msg === 'change-needs-cancel') { showToast('ℹ️', 'استفتاء', 'التغيير المباشر غير متاح — اضغط «إلغاء التصويت» بجانب اسمك ثم اختر خياراً آخر'); return; }",
    'R7: toast for change-needs-cancel')

# R8: شرح الواجهة (مكانان)
rep('ويمكن سحب الصوت بالضغط على نفس الخيار أو بزر «إلغاء التصويت» بجانب اسم المصوت — حتى إذا كان الاستفتاء مقفولاً.',
    'ويمكن سحب الصوت بالضغط على نفس الخيار أو بزر «إلغاء التصويت» بجانب اسم المصوت — وهذا هو طريق تغيير الاختيار في كل الاستفتاءات.',
    'R8: att-hint texts', expect=2)

# R9: تعليق متغيّر القفل (يظل معرَّفاً للتوافق مع البيانات القديمة)
rep('  const lock = p.lockVote === true || p.locked === true; // يقفل إعادة التصويت / السحب إذا فعّله المنشئ',
    '  const lock = p.lockVote === true || p.locked === true; // شارة المنشئ القديمة — السلوك موحّد الآن: التغيير عبر «إلغاء التصويت» في كل الحالات',
    'R9: lock comment updated')

# كتابة الملف
out = text.replace('\n', '\r\n') if crlf else text
with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(out)
print('DONE: %d edits applied' % steps)

