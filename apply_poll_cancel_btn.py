# -*- coding: utf-8 -*-
# تعديل: زر "إلغاء التصويت" بجانب اسم المصوت الحالي في الاستفتاء
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

# حماية: لا نطبّق مرتين (إعادة التشغيل تخرج مبكراً)
if '.poll-voter-cancel' in text:
    print('SKIP: التعديلات مطبَّقة مسبقاً')
    sys.exit(0)

# ── R1: CSS — صف الاسم + زر الإلغاء ──
CSS_ANCHOR = '  .poll-voters-grid .poll-voter-name, .poll-voters-grid .poll-voter-time { text-align: right; }'
if text.count(CSS_ANCHOR) != 1:
    fail('R1 anchor found %d times' % text.count(CSS_ANCHOR))
NEW_CSS = CSS_ANCHOR + '''
  /* صف اسم المصوت + زر إلغاء التصويت بجانبه (لصاحبه فقط) */
  .poll-voter-row { display: flex; align-items: center; gap: 6px; width: 100%; min-width: 0; }
  .poll-voter-row .poll-voter-name { flex: 0 1 auto; min-width: 0; }
  .poll-voter-cancel {
    flex-shrink: 0; font-size: 10px; font-weight: 800; font-family: var(--font);
    color: #f87171; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.35);
    border-radius: 8px; padding: 2px 7px; line-height: 1.5; cursor: pointer; white-space: nowrap;
    transition: transform 0.15s, background 0.2s;
  }
  .poll-voter-cancel:active { transform: scale(0.95); }
  .poll-voter-cancel:hover { background: rgba(239,68,68,0.2); }'''
text = text.replace(CSS_ANCHOR, NEW_CSS)
steps += 1
print('ok  - R1: cancel button CSS')

# ── R2: دالة العنصر — زر إلغاء التصويت بجانب اسم صاحب الصوت ──
s_marker = 'function pollVoterAvatarHtml(key, label, voteTime) {'
e_marker = 'let expandedPollIds = new Set();'
s = text.find(s_marker)
e = text.find(e_marker)
if s < 0 or e < 0 or e <= s:
    fail('R2 markers not found s=%d e=%d' % (s, e))
if text.count(s_marker) != 1:
    fail('R2 start marker not unique')

NEW_FUNC = '''function pollVoterAvatarHtml(key, label, voteTime, opts) {
  const k = voterKey(key);
  ensurePollVoterProfile(k);                                              // يجلب صورة/اسم المصوت عند أول ظهور له
  const photo = pollVoterPhoto(k);
  const rawLabel = String(label || '').replace(/^@/, '');
  const safeLabel = sanitizeText(rawLabel).replace(/"/g, '&quot;');
  const letter = (String(rawLabel || '؟').trim().charAt(0) || '؟');
  const timeHtml = voteTime ? `<div class="poll-voter-time">${timeAgo(voteTime)}</div>` : '';
  const imgHtml = photo
    ? `<img class="poll-voter-img" src="${sanitizeText(photo).replace(/"/g, '&quot;')}" alt="" loading="lazy" title="${safeLabel}" data-letter="${sanitizeText(letter).replace(/"/g, '&quot;')}" onerror="pollVoterImgFail(this)">`
    : `<span class="poll-voter-img" style="background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;" title="${safeLabel}">${sanitizeText(letter)}</span>`;
  // زر "إلغاء التصويت" بجانب اسم صاحب الصوت فقط: يسحب الصوت ليعود قادرًا على التصويت مجدداً
  // (لا يظهر لغيري، ولا إن كان الاستفتاء مقفولاً أو ممنوعاً لحسابي)
  let cancelBtn = '';
  try {
    if (opts && opts.canWithdraw && hasMyKey([k])) {
      cancelBtn = `<button type="button" class="poll-voter-cancel" onclick="event.stopPropagation(); votePoll('${escJS(String(opts.id))}', ${Number(opts.idx) || 0}, '${escJS(String(opts.coll || 'reports'))}')" title="سحب صوتك من هذا الخيار حتى تصوّت مجدداً">إلغاء التصويت</button>`;
    }
  } catch (e) {}
  const nameHtml = cancelBtn
    ? `<div class="poll-voter-row"><div class="poll-voter-name">${safeLabel}</div>${cancelBtn}</div>`
    : `<div class="poll-voter-name">${safeLabel}</div>`;
  return `<div class="poll-voter-item">${imgHtml}<div class="poll-voter-info" style="flex:1;min-width:0;">${nameHtml}${timeHtml}</div></div>`;
}
'''
text = text[:s] + NEW_FUNC + text[e:]
steps += 1
print('ok  - R2: pollVoterAvatarHtml with cancel button')

# ── R3: تمرير بيانات الاستفتاء + إذن السحب عند رسم المصوتين ──
OLD3 = "      const imgs = visible.map(k => pollVoterAvatarHtml(k, pollVoterLabel(k), voterTime(k))).join('');"
NEW3 = '''      // السحب مسموح إن لم يُقفل الاستفتاء ولدي صلاحية التصويت (الزر يظهر لصوتي أنا فقط داخل الدالة)
      const canWithdraw = !lock && (!currentUser || userHasPerm(currentUser, 'vote'));
      const imgs = visible.map(k => pollVoterAvatarHtml(k, pollVoterLabel(k), voterTime(k), { id: r.id, idx: i, coll, canWithdraw })).join('');'''
if text.count(OLD3) != 1:
    fail('R3 block found %d times' % text.count(OLD3))
text = text.replace(OLD3, NEW3)
steps += 1
print('ok  - R3: opts passed from reportPollHtml')

# ── كتابة الملف بنفس أسلوب الأسطر الأصلي ──
out = text.replace('\n', '\r\n') if crlf else text
with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(out)
print('DONE: %d edits applied' % steps)
