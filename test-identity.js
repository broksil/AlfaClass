// اختبار وحدة لطبقة الهوية في index.html — يحاكي: تغيير الاسم واليوزر ثم التحقق من بقاء الهوية
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'index.html');
const html = fs.readFileSync(file, 'utf8');

const start = html.indexOf('function getMyVoterKey()');
const end = html.indexOf('// حماية: أي خطأ في المرفقات');
if (start < 0 || end < 0 || end <= start) {
  console.error('FAIL: markers not found start=%d end=%d', start, end);
  process.exit(1);
}
const code = html.slice(start, end);

// محاكاة بيئة المتصفح
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
let currentUser = null;
let accProfile = null;

eval(code); // يستخرج الدوال إلى نطاق الاختبار

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  ok  -', name); }
  else { fail++; console.log('  FAIL-', name, 'got=' + g, 'want=' + w); }
};

console.log('== 1) حساب غيّر يوزره واسمه (الأيدي ثابت) ==');
currentUser = { userId: '123456', code: 'newuser', name: 'الاسم الجديد' };
accProfile = {
  _id: '123456', userId: '123456', username: 'newuser',
  previousUsername: 'olduser', emailPrefix: 'olduser',
  takenUsernames: ['olduser', 'newuser'], fullName: 'الاسم الجديد',
  previousFullNames: ['الاسم القديم']
};
eq('مفتاح الكتابة = الأيدي', getMyVoterKey(), '123456');
eq('إعجاب/تصويت قديم باليوزر القديم يُحسب لي', hasMyKey(['olduser']), true);
eq('إعجاب/تصويت بالأيدي يُحسب لي', hasMyKey(['123456']), true);
eq('تصويت شخص آخر لا يُحسب لي', hasMyKey(['999999']), false);
eq('إزالة كل مفاتيحي من مصفوفة', stripMyKeys(['olduser', '123456', '999999']), ['999999']);
eq('رسالة بأيدي مرسلها أنا', isMsgMine({ senderId: '123456' }), true);
eq('رسالة باليوزر القديم مرسلها أنا', isMsgMine({ senderId: 'olduser' }), true);
eq('رسالة قديمة بالاسم فقط (بدون senderId)', isMsgMine({ senderName: 'الاسم الجديد' }), true);
eq('رسالة باسمي لكن من شخص آخر (يوجد senderId مختلف)', isMsgMine({ senderId: '999999', senderName: 'الاسم الجديد' }), false);
eq('رسالة شخص آخر', isMsgMine({ senderId: '999999' }), false);
eq('مفتاح القراءة = الأيدي', myReadKey(), '123456');
eq('قرأتُ سابقاً باسمي القديم الكامل', readByHasMe(['الاسم القديم']), true);
eq('قرأتُ سابقاً باسمي الحالي', readByHasMe(['الاسم الجديد']), true);
eq('لم أقرأ', readByHasMe([]), false);
eq('مفتاح مؤشر الكتابة = الأيدي', typingIdentityKey(), '123456');
eq('تجميع: نفس الأيدي', sameSender({ senderId: '123456' }, { senderId: '123456' }), true);
eq('تجميع: قديم بالاسم', sameSender({ senderName: 'أ' }, { senderName: 'أ' }), true);
eq('تجميع: شخصان مختلفان', sameSender({ senderId: '1' }, { senderId: '2' }), false);

console.log('== 2) المفاتيح كلها (توافق البيانات القديمة) ==');
const keys = myIdentityKeys();
['123456', 'newuser', 'الاسم الجديد', 'olduser', 'olduser', 'الاسم الجديد'].forEach(k => {
  eq('المفتاح "' + k + '" موجود', keys.includes(k), true);
});
eq('لا يحتوي مفتاح شخص آخر', keys.includes('999999'), false);

console.log('== 3) زائر (بدون جلسة) ==');
currentUser = null; accProfile = null;
store['guestId'] = '4321';
eq('مفتاح الزائر = guestId', getMyVoterKey(), '4321');
eq('مفاتيح الزائر = [guestId]', myIdentityKeys(), ['4321']);
eq('إعجاب زائر قديم يُحسب له', hasMyKey(['4321']), true);

console.log('== 4) مستخدم بلا userId بعد (جلسات قديمة) ==');
currentUser = { userId: '', code: 'legacy', name: 'قديم' };
accProfile = null;
eq('مفتاح الكتابة = اليوزر (حتى يُنشأ الأيدي)', getMyVoterKey(), 'legacy');
eq('المفاتيح تشمل اليوزر', myIdentityKeys().includes('legacy'), true);

console.log('== 5) عرض المصوتين/القراء ==');
currentUser = { userId: '654321', code: 'member1', name: 'عضو واحد' };
accProfile = { _id: '654321', userId: '654321', username: 'member1', fullName: 'عضو واحد', takenUsernames: ['member1'] };
store['alfa_id_names'] = JSON.stringify({ '654321': { u: 'member1', n: 'عضو واحد' } });
eq('يوزر قديم يُعرض كما هو', identityLabel('olduser'), 'olduser');
eq('أيدي معروف → اسمه الكامل (يُفضَّل على اليوزر)', identityLabel('654321'), 'عضو واحد');
eq('أيدي مجهول → عضو #id', identityLabel('111222'), 'عضو #111222');
eq('معرّف المالك 666 → عضو #666', identityLabel('666'), 'عضو #666');
eq('معرّف زائر → زائر', identityLabel('4321'), 'زائر 4321');

console.log('');
console.log('النتيجة: ' + pass + ' ناجح، ' + fail + ' فاشل');
process.exit(fail ? 1 : 0);
