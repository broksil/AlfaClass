const ARABIC_TO_ENGLISH_MAP = {
  'ا':'a','أ':'a','إ':'a','آ':'a','ى':'a',
  'و':'u','ي':'i','ب':'b','ت':'t','ث':'th','ج':'j',
  'ح':'h','خ':'kh','د':'d','ذ':'th','ر':'r','ز':'z',
  'س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z',
  'ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l',
  'م':'m','ن':'n','ه':'h','ة':'h','ے':'y',
  'َ':'', 'ً':'', 'ُ':'', 'ٌ':'', 'ِ':'', 'ٍ':'', 'ْ':'',
  ' ':'','_':'_','-':'_','.':'',"'":''
};

function transliterateToEnglish(name) {
  if (!name) return '';
  let out = '';
  for (const ch of name) {
    const m = ARABIC_TO_ENGLISH_MAP[ch];
    if (m && m !== '') out += m;
  }
  return out;
}

function generateTelegramUsername({ firstName, telegramUserId }) {
  if (!firstName || firstName.trim() === '') {
    throw new Error('Cannot generate username: First name is empty.');
  }
  let name = transliterateToEnglish(firstName.trim()).toLowerCase();
  name = name.replace(/[^a-z0-9_]/g, '');
  if (name.length === 0) {
    name = firstName.trim().substring(0, 3).toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  }
  let username = `${name}_${telegramUserId}`;
  const MAX_LEN = 32;
  if (username.length > MAX_LEN) {
    const sep = username.lastIndexOf('_');
    const idPart = username.slice(sep + 1);
    username = username.slice(0, sep).substring(0, MAX_LEN - idPart.length - 1) + '_' + idPart;
  }
  return username;
}

function generateUsernameWithFallback({ firstName, telegramUserId, username, takenUsernames = [] }) {
  if (username && username.trim()) {
    const norm = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 32);
    if (norm) return norm;
  }
  return generateTelegramUsername({ firstName, telegramUserId });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { transliterateToEnglish, generateTelegramUsername, generateUsernameWithFallback };
}
