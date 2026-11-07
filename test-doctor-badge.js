// اختبار: شارة التوثيق بجانب أسماء الدكاترة (البلاغات + إعلانات الأساتذة) في index.html
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

// ── 1) استخراج المنطقة: سجل الأساتذة + isDoctorName + doctorBadgeHTML ──
console.log('== 1) استخراج وصياغة ==');
const teachersBlock = slice('const ANN_TEACHERS = {', 'const ANN_MONTHS', 'teachers+doctors block');
let isDoctorName, doctorBadgeHTML, annTeacherInfo, ANN_TEACHERS;
try {
  ({ isDoctorName, doctorBadgeHTML, annTeacherInfo, ANN_TEACHERS } = new Function(teachersBlock + '\nreturn { isDoctorName, doctorBadgeHTML, annTeacherInfo, ANN_TEACHERS };')());
  ok('المنطقة تُحلَّج بلا أخطاء', true);
} catch (e) { ok('المنطقة تُحلَّج بلا أخطاء', false, e.message); process.exit(1); }

// ── 2) تمييز الأسماء الدكتورة ──
console.log('== 2) isDoctorName ==');
ok('«د. أحمد» عربي بنقطة', isDoctorName('د. أحمد') === true);
ok('«د فلان» عربي بلا نقطة', isDoctorName('د محمد كريم') === true);
ok('«دكتورة إيناس» بادئة دكتورة', isDoctorName('دكتورة إيناس سعد') === true);
ok('«الدكتور فلان» بالألقاب', isDoctorName('الدكتور علي حسن') === true);
ok('«أ.د. فلان» أستاذ دكتور', isDoctorName('أ.د. مصطفى جاسم') === true);
ok('«استاذ دكتور فلان»', isDoctorName('استاذ دكتور كريم') === true);
ok('«dr. enas saad» إنجليزي بنقطة', isDoctorName('dr. enas saad') === true);
ok('«Dr enas saad» إنجليزي بحرف كبير', isDoctorName('Dr Enas Saad') === true);
ok('«prof. someone» أستاذ جامعي', isDoctorName('prof. someone') === true);
ok('«x PhD» في نهاية الاسم', isDoctorName('mohammed phd') === true);
ok('«مسجّل في السجل بالإنجليزية» batool younus', isDoctorName('batool younus') === true);
ok('«مسجّلة بالعربي من السجل» الدكتورة إيناس سعد', isDoctorName('الدكتورة إيناس سعد') === true);
ok('اسم عضو عادي ليس دكتوراً', isDoctorName('علي حسن') === false);
ok('اسم بلا قيمة ليس دكتوراً', isDoctorName('') === false);
ok('«داليا خالد» لا تُعدّ دكتورة (حرف د في الوسط لا لقب)', isDoctorName('داليا خالد') === false);

// ── 3) html الشارة ──
console.log('== 3) doctorBadgeHTML ==');
const b1 = doctorBadgeHTML('د. أحمد');
ok('الشارة تُولَّد لدكتور', b1.includes('verified-badge') && b1.includes('موثّق'), b1);
ok('لا شارة لعضو عادي', doctorBadgeHTML('علي حسن') === '');

// ── 4) ربط الشارة في بلاغات الممثل + إعلانات الأساتذة ──
console.log('== 4) الربط في البلاغات والإعلانات ==');
ok('reportAuthorHtml يستدعي doctorBadgeHTML كخيار ثانٍ', html.includes('verifiedBadgeHTML(authorId, r.author) || doctorBadgeHTML(r.author)'));
ok('annBuildCard يبني teacherBadge', html.includes('const teacherBadge = a.teacherName'));
ok('اسم الأستاذ في البطاقة يحمل الشارة', html.includes('${sanitizeText(t.ar)}${teacherBadge}'));
ok('مزامنة شارة البلاغ مع الاسم الحيّ في enhanceAuthorNames', html.includes('const wantBadge = verifiedBadgeHTML(pid, p.fullName) || doctorBadgeHTML(p.fullName)'));
ok('CSS لشارة الأستاذ موجود', html.includes('.ann-teacher-name .verified-badge'));
ok('CSS لشارة المصوت في الاستفتاء موجود', html.includes('.poll-voter-row .verified-badge'));

console.log('');
console.log(fail === 0 ? ('PASS: ' + pass + ' checks') : ('FAIL: ' + fail + ' failed / ' + (pass + fail)));
process.exit(fail === 0 ? 0 : 1);