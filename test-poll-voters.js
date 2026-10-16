// اختبار: صور الملفات الشخصية + الأسماء للمصوتين في الاستفتاء (index.html)
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function slice(startMark, endMark, label) {
  const s = html.indexOf(startMark), e = html.indexOf(endMark);
  if (s < 0 || e < 0 || e <= s) { console.error('FAIL: markers not found for', label, s, e); process.exit(1); }
  return html.slice(s, e);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  -', name); }
  else { fail++; console.log('  FAIL-', name, extra == null ? '' : '=> ' + extra); }
};

// ── 1) فحص صياغة الكتل المعدّلة ──
console.log('== 1) صياغة JS ==');
const votersBlock = slice('function pollVoterLabel(key) {', 'let expandedPollIds = new Set();', 'voters block');
const reportPollBlock = slice('function reportPollHtml(r, coll', 'window.votePoll = async function', 'reportPollHtml');
try { new Function(votersBlock); new Function(reportPollBlock); ok('الصياغة سليمة', true); }
catch (e) { ok('الصياغة سليمة', false, e.message); }
ok('CSS زر إلغاء التصويت موجود', html.includes('.poll-voter-cancel') && html.includes('.poll-voter-row'));

// ── 2) بيئة محاكاة واختبار المنطق ──
console.log('== 2) منطق عرض المصوتين ==');
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
const documentStub = {
  createElement: () => {
    let t = '';
    return {
      set textContent(v) { t = String(v); },
      get innerHTML() { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    };
  }
};
const _pollVoterProfileCache = new Map();
let renderCount = 0;
let profileRequests = 0;
let memberRequests = 0;
const env = {
  localStorage,
  document: documentStub,
  window: {},
  _usersPhotoMap: null,
  _pollVoterProfileCache,
  currentUser: null,
  accProfile: null,
  voterKey: v => (typeof v === 'object' && v ? String(v.k || v.key || '') : String(v == null ? '' : v)),
  myKeys: ['654321'],
  hasMyKey: arr => (arr || []).some(v => ['654321'].includes(String(v == null ? '' : (typeof v === 'object' ? (v.k || v.key || '') : v)))),
  escJS: s => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"),
  userHasPerm: () => true,
  identityLabel: k => 'identity#' + k,
  sanitizeText: t => { const d = documentStub.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; },
  timeAgo: ts => (ts ? 'منذ قليل' : ''),
  rememberIdName: () => {},
  resolveAuthorIdByName: async n => (/^1/.test(String(n)) ? '555' : null),
  loadAuthorProfile: async k => {
    profileRequests++;
    if (k === '654321') { memberRequests++; return { userId: '654321', username: 'member1', fullName: 'عضو واحد', photoURL: 'https://x/p.png' }; }
    return null;
  },
  renderReports: () => { renderCount++; },
  refreshOfflinePosts: () => {}
};
const factory = new Function('env', 'with(env){' + votersBlock + '} return { pollVoterLabel, pollVoterPhoto, pollVoterAvatarHtml, ensurePollVoterProfile };');
const api = factory(env);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // الزائر: بلا صورة لكنه يظهر باسمه وحرفه
  const guestHtml = api.pollVoterAvatarHtml({ k: '4321' }, api.pollVoterLabel('4321'), Date.now());
  ok('اسم الزائر يظهر في المصوتين', guestHtml.includes('زائر 4321'), guestHtml);
  ok('حرف احتياطي للمصوت بلا صورة', guestHtml.includes('>ز</span>'), guestHtml);
  ok('الزائر يظهر مع وقت التصويت', guestHtml.includes('poll-voter-time') && guestHtml.includes('منذ قليل'));

  // عضو: قبل وصول الصورة (حرف) ثم بعده (صورة الملف الشخصي + الاسم الحيّ)
  const before = api.pollVoterAvatarHtml('654321', api.pollVoterLabel('654321'), 0);
  ok('قبل التحميل: الاسم يظهر والصورة حرف', before.includes('identity#654321') && !before.includes('<img'), before);
  await sleep(60);
  ok('الاسم الحيّ من الملف الشخصي يظهر', api.pollVoterLabel('654321') === 'عضو واحد', api.pollVoterLabel('654321'));
  ok('صورة الملف الشخصي تُجلب للمصوت', api.pollVoterPhoto('654321') === 'https://x/p.png', api.pollVoterPhoto('654321'));
  const after = api.pollVoterAvatarHtml('654321', api.pollVoterLabel('654321'), Date.now());
  ok('بعد التحميل: يظهر <img> بالصورة والاسم', after.includes('<img class="poll-voter-img" src="https://x/p.png"') && after.includes('عضو واحد'), after);

  // طلب الملف مرة واحدة فقط لكل مصوت
  api.pollVoterAvatarHtml('654321', api.pollVoterLabel('654321'), 0);
  api.ensurePollVoterProfile('654321');
  ok('جلب ملف المصوت مرة واحدة فقط', memberRequests === 1, memberRequests);

  // إعادة الرسم التلقائي بعد وصول الصورة/الاسم
  await sleep(400);
  ok('إعادة رسم الاستفتاء بعد وصول البيانات', renderCount >= 1, renderCount);

  // صورتي أنا أولاً من حسابي الحالي
  env.currentUser = { userId: '999', code: 'me', name: 'أنا' };
  env.accProfile = { photoURL: 'https://me/a.png' };
  ok('صورة حسابي الحالي مباشرة', api.pollVoterPhoto('999') === 'https://me/a.png', api.pollVoterPhoto('999'));
  env.currentUser = null; env.accProfile = null;

  // مفتاح قديم بصيغة اسم كامل: يُحلّ إلى أدي ثم يُجلب ملفه الحيّ
  env.resolveAuthorIdByName = async n => (n === 'قديم اسم' ? '555' : null);
  env.loadAuthorProfile = async k => (k === '555'
    ? { userId: '555', username: 'old', fullName: 'القديم', photoURL: 'https://x/old.png' }
    : null);
  api.ensurePollVoterProfile('قديم اسم');
  await sleep(60);
  ok('الاسم القديم يُحلّ ويعرض الاسم الحيّ', api.pollVoterLabel('قديم اسم') === 'القديم', api.pollVoterLabel('قديم اسم'));
  ok('صورته تُجلب من ملفه الحيّ', api.pollVoterPhoto('قديم اسم') === 'https://x/old.png', api.pollVoterPhoto('قديم اسم'));

  // زر "إلغاء التصويت" بجانب اسم صاحب الصوت فقط
  const withBtn = api.pollVoterAvatarHtml('654321', 'عضو واحد', Date.now(), { id: 'r1', idx: 0, coll: 'reports', canWithdraw: true });
  ok('الزر يظهر بجانب اسمي', withBtn.includes('إلغاء التصويت'), withBtn);
  ok('الزر يستدعي votePoll بالخيارات الصحيحة', withBtn.includes("votePoll('r1', 0, 'reports')"), withBtn);
  ok('الاسم يبقى داخل صف ملاصق للزر', withBtn.includes('poll-voter-row') && withBtn.includes('poll-voter-name">عضو واحد'), withBtn);
  const lockedHtml = api.pollVoterAvatarHtml('654321', 'عضو واحد', Date.now(), { id: 'r1', idx: 0, coll: 'reports', canWithdraw: false });
  ok('لا زر عندما يمرّر المُنشئ canWithdraw=false', !lockedHtml.includes('إلغاء التصويت'));
  const otherHtml = api.pollVoterAvatarHtml('111222', 'آخر', Date.now(), { id: 'r1', idx: 0, coll: 'reports', canWithdraw: true });
  ok('لا زر بجانب اسم غيري', !otherHtml.includes('إلغاء التصويت'));
  const noOpts = api.pollVoterAvatarHtml('654321', 'عضو واحد', Date.now());
  ok('استدعاء بلا opts (توافق قديم) بلا زر وبلا خطأ', !noOpts.includes('إلغاء التصويت'));

  // شارة +N تفتح كل المصوتين
  ok('شارة +N قابلة للنقر لعرض كل المصوتين', reportPollBlock.includes("togglePollVotersInline('${escJS(r.id)}', ${i})"));

  // ── 3) شارة التوثيق بجانب اسم المصوت: للمالك (666/baqer) فقط ──
  console.log('== 3) شارة توثيق المالك في المصوتين ==');
  ok('دالة تمييز مفتاح المالك موجودة', votersBlock.includes('function isOwnerVoterKey('));
  // بيئة تعاريف المالك (666 + baqer) كما في index.html الحقيقي
  const ownerEnv = Object.assign({}, env, {
    OWNER_USER_ID: 666,
    AUTH_OWNER: 'baqer',
    hasMyKey: arr => (Array.isArray(arr) ? arr.some(v => ['666', 'baqer'].includes(String(v == null ? '' : (typeof v === 'object' ? (v.k || v.key || '') : v)))) : false)
  });
  const ownerApi = new Function('env', 'with(env){' + votersBlock + '} return { pollVoterAvatarHtml, isOwnerVoterKey, ownerVerifiedBadgeHTML };')(ownerEnv);
  ok('مفتاح 666 يُعدّ مفتاح المالك', ownerApi.isOwnerVoterKey('666') === true);
  ok('اليوزر baqer يُعدّ مفتاح المالك', ownerApi.isOwnerVoterKey('baqer') === true);
  ok('مفتاح عضو عادي ليس مفتاح المالك', ownerApi.isOwnerVoterKey('654321') === false);
  const ownerHtml = ownerApi.pollVoterAvatarHtml('666', 'مالك الموقع', Date.now(), { id: 'r1', idx: 0, coll: 'reports', canWithdraw: true });
  ok('الشارة تظهر بجانب اسم المالك', ownerHtml.includes('verified-badge'), ownerHtml);
  ok('الشارة تسبق اسم المالك مباشرة في صف الاسم', ownerHtml.includes('poll-voter-name\">مالك الموقع'), ownerHtml);
  const memberHtml = ownerApi.pollVoterAvatarHtml('654321', 'عضو واحد', Date.now(), { id: 'r1', idx: 0, coll: 'reports', canWithdraw: true });
  ok('لا شارة بجانب اسم عضو عادي', !memberHtml.includes('verified-badge'), memberHtml);
  ok('زر الإلغاء يبقى بجانب الاسم مع الشارة', ownerHtml.includes('إلغاء التصويت'), ownerHtml);
  // بيانات قديمة: تصويت باسم المالك الكامل أو يوزره المسجّل في alfa_id_names
  store['alfa_id_names'] = JSON.stringify({ '666': { u: 'owneruser', n: 'باقر الموقع' } });
  ok('تصويت قديم باسم المالك الكامل يُعدّ مالكاً', ownerApi.isOwnerVoterKey('باقر الموقع'), true);
  ok('تصويت قديم باليوزر المسجّل في الخريطة يُعدّ مالكاً', ownerApi.isOwnerVoterKey('owneruser'), true);
  delete store['alfa_id_names'];

  console.log('');
  console.log(fail === 0 ? ('PASS: ' + pass + ' checks') : ('FAIL: ' + fail + ' failed / ' + (pass + fail)));
  process.exit(fail === 0 ? 0 : 1);
})();

