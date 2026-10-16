// اختبار دورة حياة التصويت الكاملة: تصويت ← عرض ← إلغاء التصويت ← عرض ← إعادة التصويت
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function slice(startMark, endMark, label) {
  const s = html.indexOf(startMark), e = html.indexOf(endMark);
  if (s < 0 || e < 0 || e <= s) { console.error('FAIL: markers for', label, s, e); process.exit(1); }
  return html.slice(s, e);
}
// المنطقة المتماسكة: escJS + دوال المصوتين + reportPollHtml + votePoll
const code = slice('function escJS(s) {', 'function openReportsView()', 'poll region');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ok  -', name); }
  else { fail++; console.log('  FAIL-', name, extra == null ? '' : '=> ' + extra); }
};

// ── بيئة محاكاة ──
const store = { id: 'r1', poll: { question: 'سؤال', options: [
  { text: 'خيار أ', votes: 0, voters: [] },
  { text: 'خيار ب', votes: 0, voters: [] }
], hidePercent: false, hideVoters: false, lockVote: false } };
const toasts = [];
const env = {
  console, setTimeout, clearTimeout, JSON, Date, Math, Promise,
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: { createElement: () => { let t = ''; return { set textContent(v) { t = String(v); }, get innerHTML() { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }; } },
  window: {},
  currentUser: { userId: '654321', code: 'member1', name: 'عضو واحد' },
  accProfile: null,
  _usersPhotoMap: null,
  _pollVoterProfileCache: new Map(),
  expandedPollIdsStub: null,
  voterKey: v => (typeof v === 'object' && v ? String(v.k || v.key || '') : String(v == null ? '' : v)),
  voterTime: v => (typeof v === 'object' ? Number(v.t || 0) : 0),
  timeAgo: ts => (ts ? 'منذ قليل' : ''),
  identityLabel: k => 'عضو #' + k,
  sanitizeText: t => { const d = env.document.createElement('div'); d.textContent = t == null ? '' : t; return d.innerHTML; },
  loadAuthorProfile: async () => null,
  resolveAuthorIdByName: async () => null,
  rememberIdName: () => {},
  myIdentityKeys: () => ['654321', 'olduser'],
  getMyVoterKey: () => '654321',
  hasMyKey: arr => (Array.isArray(arr) ? arr.some(v => ['654321', 'olduser'].includes(env.voterKey(v))) : false),
  userHasPerm: () => true,
  renderReports: () => {},
  refreshOfflinePosts: () => {},
  showToast: (i, t, s) => toasts.push(String(s || '')),
  db: {},
  doc: (db, coll, id) => ({ coll, id }),
  runTransaction: async (db, txFn) => {
    const snapshot = JSON.parse(JSON.stringify(store));
    const tx = {
      get: async ref => ({ exists: () => true, data: () => snapshot }),
      update: (ref, data) => { if (data && data['poll.options']) store.poll.options = data['poll.options']; }
    };
    return await txFn(tx);
  }
};
const factory = new Function('env', 'with(env){' + code + '\nreturn { reportPollHtml, votePoll: window.votePoll }; }');
const api = factory(env);
const last = () => toasts[toasts.length - 1] || '';

(async () => {
  // 1) قبل التصويت
  const h0 = api.reportPollHtml(store, 'reports');
  ok('1. الخيارات قابلة للتصويت قبل التصويت', h0.includes("votePoll('r1', 0, 'reports')") && h0.includes("votePoll('r1', 1, 'reports')"));
  ok('1. لا زر إلغاء قبل التصويت', !h0.includes('poll-voter-cancel'));

  // 2) تصويت على الخيار ب
  await api.votePoll('r1', 1, 'reports');
  ok('2. تم تسجيل الصوت', last().includes('تم تسجيل صوتك'), last());
  ok('2. الصوت محفوظ في الخيار الصحيح', store.poll.options[1].votes === 1 && store.poll.options[1].voters.length === 1, JSON.stringify(store.poll.options));
  const h1 = api.reportPollHtml(store, 'reports');
  ok('2. يظهر وسم "هذا صوتك"', h1.includes('هذا صوتك'));
  ok('2. زر الإلغاء ظهر بجانب اسمي', h1.includes('poll-voter-cancel') && h1.includes("votePoll('r1', 1, 'reports')"));
  ok('2. بعد التصويت: الخيارات الأخرى معطّلة (لا تغيير مباشر)', !h1.includes("votePoll('r1', 0, 'reports')"), h1);

  // 3) الضغط على "إلغاء التصويت" (نفس الخيار = سحب)
  await api.votePoll('r1', 1, 'reports');
  ok('3. تم سحب الصوت فعلاً', last().includes('تم سحب صوتك'), last());
  ok('3. الخيارات صفرت', store.poll.options[1].votes === 0 && store.poll.options[1].voters.length === 0, JSON.stringify(store.poll.options));
  const h2 = api.reportPollHtml(store, 'reports');
  ok('3. اختفى زر الإلغاء ووسم الصوت', !h2.includes('poll-voter-cancel') && !h2.includes('هذا صوتك'));
  ok('3. الخيارات قابلة للتصويت مجدداً بعد الإلغاء', h2.includes("votePoll('r1', 0, 'reports')") && h2.includes("votePoll('r1', 1, 'reports')"));

  // 4) إعادة التصويت بعد الإلغاء (على خيار آخر)
  await api.votePoll('r1', 0, 'reports');
  ok('4. أعاد التصويت بنجاح بعد الإلغاء', last().includes('تم تسجيل صوتك') && store.poll.options[0].votes === 1, JSON.stringify(store.poll.options));

  // 5) التغيير المباشر ممنوع في كل الاستفتاءات — المسار الكامل عبر "إلغاء التصويت"
  const h5 = api.reportPollHtml(store, 'reports');
  ok('5. غير المقفل: خياري قابل والآخر معطّل', h5.includes('poll-voter-cancel') && h5.includes("votePoll('r1', 0, 'reports')") && !h5.includes("votePoll('r1', 1, 'reports')"));
  const before5 = JSON.stringify(store.poll.options);
  await api.votePoll('r1', 1, 'reports'); // محاولة تغيير مباشر
  ok('5. التغيير المباشر مرفوض برسالة توجيه', last().includes('إلغاء التصويت') && JSON.stringify(store.poll.options) === before5, last());
  await api.votePoll('r1', 0, 'reports'); // إلغاء
  ok('5. ثم الإلغاء', last().includes('تم سحب صوتك'), last());
  await api.votePoll('r1', 1, 'reports'); // ثم التصويت بالخيار الآخر
  ok('5. ثم التصويت بالخيار الآخر (المسار الكامل)', last().includes('تم تسجيل صوتك') && store.poll.options[1].votes === 1 && store.poll.options[0].votes === 0, JSON.stringify(store.poll.options));

  // 6) الاستفتاء المقفل: زر "إلغاء التصويت" هو بوابة تغيير الخيار
  store.poll.lockVote = true;
  const h3 = api.reportPollHtml(store, 'reports');
  ok('6. بالقفل: زر الإلغاء ظاهر بجانب اسمي', h3.includes('poll-voter-cancel'));
  ok('6. بالقفل: خياري أنا قابل للنقر للسحب', h3.includes("votePoll('r1', 1, 'reports')"));
  ok('6. بالقفل: الخيارات الأخرى معطّلة (لا تغيير مباشر)', !h3.includes("votePoll('r1', 0, 'reports')"));
  const beforeChange = JSON.stringify(store.poll.options);
  await api.votePoll('r1', 0, 'reports'); // محاولة تغيير مباشر (نداء مباشر)
  ok('6. التغيير المباشر مرفوض مع توجيه لزر الإلغاء', last().includes('إلغاء التصويت') && JSON.stringify(store.poll.options) === beforeChange, last());
  await api.votePoll('r1', 1, 'reports'); // زر "إلغاء التصويت" على خياري
  ok('6. الإلغاء يعمل حتى بالقفل', last().includes('تم سحب صوتك') && store.poll.options[1].votes === 0, last());
  await api.votePoll('r1', 0, 'reports'); // يصوّت بخيار آخر بعد الإلغاء والمقفل ما زال مفعّلاً
  ok('6. يصوّت بخيار آخر بعد الإلغاء حتى بالقفل', last().includes('تم تسجيل صوتك') && store.poll.options[0].votes === 1, JSON.stringify(store.poll.options));
  const h4 = api.reportPollHtml(store, 'reports');
  ok('6. الإرشاد يوضّح مسار التغيير عبر الإلغاء', h4.includes('اضغط «إلغاء التصويت» بجانب اسمك'));
  store.poll.lockVote = false;

  console.log('');
  console.log(fail === 0 ? ('PASS: ' + pass + ' checks') : ('FAIL: ' + fail + ' failed / ' + (pass + fail)));
  process.exit(fail === 0 ? 0 : 1);
})();

