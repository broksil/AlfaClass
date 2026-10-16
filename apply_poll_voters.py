# -*- coding: utf-8 -*-
# تعديل: إظهار صور الملفات الشخصية مع الأسماء للمصوتين في الاستفتاء (الاستبيان)
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

# حماية: لا نطبّق التعديلات مرتين (إعادة التشغيل تخرج مبكراً)
if '_pollVoterProfileCache' in text and 'ensurePollVoterProfile' in text:
    print('SKIP: التعديلات مطبَّقة مسبقاً')
    sys.exit(0)

# ── R1: كاش صور/أسماء المصوتين (يُعلن بجانب كاشات الصور الأخرى) ──
lines = text.split('\n')
hits = [i for i, l in enumerate(lines) if l.startswith('let _usersPhotoMap = null;')]
if len(hits) != 1:
    fail('R1 anchor found %d times' % len(hits))
lines.insert(hits[0] + 1,
    'const _pollVoterProfileCache = new Map(); // مفتاح المصوت → { photo, name } — كاش صور/أسماء المصوتين في الاستفتاء (متزامن أثناء الرسم)')
text = '\n'.join(lines)
steps += 1
print('ok  - R1: _pollVoterProfileCache declared')

# ── R2: إبطال الكاش عند تغيير أي صورة ملف شخصي ──
lines = text.split('\n')
fi = [i for i, l in enumerate(lines) if l.strip() == 'function invalidateAuthorPhotos(authorId) {']
if len(fi) != 1:
    fail('R2 anchor found %d times' % len(fi))
mi = [i for i in range(fi[0], min(fi[0] + 8, len(lines))) if '_usersPhotoMap = null;' in lines[i]]
if len(mi) != 1:
    fail('R2 inner anchor found %d times' % len(mi))
lines.insert(mi[0] + 1, '  try { _pollVoterProfileCache.clear(); } catch (e) {} // إبطال كاش صور المصوتين بعد تغيير صورة ملف شخصي')
text = '\n'.join(lines)
steps += 1
print('ok  - R2: cache invalidated with author photos')

# ── R3: استبدال دوال المصوتين (الاسم/الصورة/الصورة الرمزية) ──
s_marker = 'function pollVoterLabel(key) {'
e_marker = 'let expandedPollIds = new Set();'
s = text.find(s_marker)
e = text.find(e_marker)
if s < 0 or e < 0 or e <= s:
    fail('R3 markers not found s=%d e=%d' % (s, e))
if text.count(s_marker) != 1:
    fail('R3 start marker not unique')

NEW_BLOCK = '''function pollVoterLabel(key) {
  const k = voterKey(key);
  const live = _pollVoterProfileCache.get(k);                             // الاسم الحيّ من الملف الشخصي (يُحمَّل أدناه)
  if (live && live.name) return sanitizeText(live.name);
  if (/^\\d{4}$/.test(k)) return `زائر ${sanitizeText(k)}`;                 // معرّف زائر (4 أرقام)
  if (/^\\d{3,6}$/.test(k)) return sanitizeText(identityLabel(k));          // معرّف عضو ثابت (الأيدي)
  if (/^[a-z0-9._\\-]{3,30}$/.test(k)) return sanitizeText(k);            // يوزر (بيانات قديمة) — بدون @
  return sanitizeText(k);                                                  // اسم كامل (بيانات قديمة)
}
// جلب صورة/اسم المصوت من مستند المستخدم (مرة واحدة لكل مفتاح) ثم إعادة رسم الاستفتاء
// لعرض صورة الملف الشخصي والاسم الحيّ بجانب كل مصوت فور توفّرهما
function ensurePollVoterProfile(key) {
  const k = voterKey(key);
  if (!k || _pollVoterProfileCache.has(k)) return;
  _pollVoterProfileCache.set(k, { photo: '', name: '' });                 // نمنع تكرار الجلب لهذا المفتاح
  try {
    loadAuthorProfile(k).then(async p => {
      // مفتاح قديم بصيغة اسم كامل: نحلّه إلى أدي ثم نجلب ملفه الحيّ
      if (!p && !/^\\d+$/.test(k) && !/^[a-z0-9._\\-]{3,30}$/.test(k)) {
        try {
          const rid = await resolveAuthorIdByName(k);
          if (rid) p = await loadAuthorProfile(rid);
        } catch (e) {}
      }
      if (!p) return;
      const photo = String(p.photoURL || '');
      const name = String(p.fullName || p.username || '');
      if (!photo && !name) return;
      _pollVoterProfileCache.set(k, { photo, name });
      try { rememberIdName(String(p.userId || p._id || k), p.username || '', p.fullName || ''); } catch (e) {}
      queuePollVotersRefresh();                                           // تحديث المعروض بالصورة/الاسم الجديدَين
    }).catch(() => {});
  } catch (e) {}
}
// إعادة رسم القائمة بعد وصول صور/أسماء جديدة (مؤجَّل قليلاً لتجميع نتائج عدة مصوتين في دور واحد)
let _pollVotersRefreshTimer = 0;
function queuePollVotersRefresh() {
  if (_pollVotersRefreshTimer) return;
  _pollVotersRefreshTimer = setTimeout(() => {
    _pollVotersRefreshTimer = 0;
    try { renderReports(); } catch (e) {}
    try { refreshOfflinePosts(); } catch (e) {}
  }, 300);
}
'''
NEW_BLOCK2 = '''function pollVoterPhoto(key) {
  const k = voterKey(key);
  if (!k) return '';
  if (currentUser) { // صورتي أولاً — مباشرة من حسابي الحالي
    const uid = String(currentUser.userId || '');
    const code = String(currentUser.code || '');
    const name = String(currentUser.name || '');
    const mePhoto = (accProfile && accProfile.photoURL) || currentUser.icon || localStorage.getItem('accAvatar') || '';
    if (uid && uid === k) return mePhoto;
    if (code && code === k) return mePhoto;
    if (name && name === k) return mePhoto;
  }
  const live = _pollVoterProfileCache.get(k);                             // صورة الملف الشخصي للمصوت (كاش محمل)
  if (live && live.photo) return live.photo;
  if (_usersPhotoMap instanceof Map) {                                    // خريطة (الاسم الكامل ← الصورة)
    const byName = _usersPhotoMap.get(k);
    if (byName) return byName;
  } else if (typeof _usersPhotoMap === 'object' && _usersPhotoMap && _usersPhotoMap[k]) {
    return _usersPhotoMap[k].photoURL || '';
  }
  return '';
}
// بديل آمن عند فشل تحميل الصورة: حرف من اسم المصوت بدل إخفائه تماماً
window.pollVoterImgFail = function(img) {
  try {
    const span = document.createElement('span');
    span.className = 'poll-voter-img';
    span.style.cssText = 'background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;';
    span.title = (img && img.getAttribute && img.getAttribute('title')) || '';
    span.textContent = (img && img.getAttribute && img.getAttribute('data-letter')) || '؟';
    img.replaceWith(span);
  } catch (e) { try { img.style.display = 'none'; } catch (e2) {} }
};
function pollVoterAvatarHtml(key, label, voteTime) {
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
  return `<div class="poll-voter-item">${imgHtml}<div class="poll-voter-info" style="flex:1;min-width:0;"><div class="poll-voter-name">${safeLabel}</div>${timeHtml}</div></div>`;
}
'''
text = text[:s] + NEW_BLOCK + NEW_BLOCK2 + text[e:]
steps += 1
print('ok  - R3: voter label/photo/avatar functions replaced')

# ── R4: عرض كل المصوتين عند الضغط على شارة +N (مع الصور والأسماء) ──
OLD4 = '''      const visible = o.voters.slice(0, 6);
      const imgs = visible.map(k => pollVoterAvatarHtml(k, pollVoterLabel(k), voterTime(k))).join('');
      const extra = o.voters.length - visible.length;
      const more = extra > 0 ? `<div class="poll-voter-item"><span class="poll-voter-img poll-voter-more">${extra}</span><div class="poll-voter-name">+${extra}</div></div>` : '';
      votersHtml = `<div class="poll-voters-grid">${imgs}${more}</div>`;'''
NEW4 = '''      const vKey = 'voters-' + String(r.id) + '-' + i;
      const vOpen = expandedPollIds.has(vKey); // قائمة المصوتين مفتوحة بالكامل (كل الأصوات بصورهم وأسمائهم)
      const visible = vOpen ? o.voters : o.voters.slice(0, 6);
      const imgs = visible.map(k => pollVoterAvatarHtml(k, pollVoterLabel(k), voterTime(k))).join('');
      const extra = o.voters.length - visible.length;
      let more = '';
      if (extra > 0) {
        more = `<div class="poll-voter-item" style="cursor:pointer" onclick="event.stopPropagation(); togglePollVotersInline('${escJS(r.id)}', ${i})" title="عرض كل المصوتين"><span class="poll-voter-img poll-voter-more">+${extra}</span><div class="poll-voter-name">+${extra} — عرض الكل</div></div>`;
      } else if (vOpen && o.voters.length > 6) {
        more = `<div class="poll-voter-item" style="cursor:pointer" onclick="event.stopPropagation(); togglePollVotersInline('${escJS(r.id)}', ${i})" title="عرض أقل"><span class="poll-voter-img poll-voter-more">▲</span><div class="poll-voter-name">عرض أقل</div></div>`;
      }
      votersHtml = `<div class="poll-voters-grid">${imgs}${more}</div>`;'''
if text.count(OLD4) != 1:
    fail('R4 block found %d times' % text.count(OLD4))
text = text.replace(OLD4, NEW4)
steps += 1
print('ok  - R4: expandable voters list (+N clickable)')

# ── كتابة الملف بنفس أسلوب الأسطر الأصلي ──
out = text.replace('\n', '\r\n') if crlf else text
with io.open(path, 'w', encoding='utf-8', newline='') as f:
    f.write(out)
print('DONE: %d edits applied' % steps)
