/**
 * AlfaClass — Telegram Mini App Auto-Authentication (Race-Condition Fixed)
 */
const USER_COLLECTION = 'users';

async function waitForTelegramData(maxWait = 2000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (
      window.Telegram &&
      window.Telegram.WebApp &&
      window.Telegram.WebApp.initDataUnsafe &&
      window.Telegram.WebApp.initDataUnsafe.user
    ) {
      return { success: true, user: window.Telegram.WebApp.initDataUnsafe.user };
    }
    await new Promise(r => setTimeout(r, interval));
  }
  const rawData = window.Telegram?.WebApp?.initData || 'COMPLETELY EMPTY';
  showError(
    'Timeout: initDataUnsafe.user not available after 2 seconds',
    `raw initData: ${rawData}`
  );
  return { success: false };
}

function setProgress(percent) {
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = percent + '%';
}

function showError(message, stack) {
  const errEl = document.getElementById('loading-error');
  if (errEl) {
    errEl.textContent = message + '\n' + stack;
    errEl.classList.add('visible');
  }
  console.error('[AlfaClass] Auth CRASH:', message, stack);
}

async function runAuthFlow() {
  window.Telegram.WebApp.ready();
  setProgress(10);
  const dataResult = await waitForTelegramData(2000, 100);
  if (!dataResult.success) throw dataResult;
  const user = dataResult.user;
  const uid = user.id;
  setProgress(40);
  const fn = user.first_name || 'مستخدم';
  const ln = user.last_name || '';
  const tu = user.username || null;
  const pu = user.photo_url || '';
  const disp = fn + ' ' + ln;
  const username = generateUsernameWithFallback({ firstName: fn, telegramUserId: uid, username: tu });
  const payload = {
    telegramUserId: uid,
    displayName: disp,
    firstName: fn,
    lastName: ln,
    username,
    avatarUrl: pu,
    telegramUsername: tu,
    bio: 'لا يوجد وصف',
  };
  setProgress(80);
  let fsResult = { success: true, action: 'skipped' };
  if (window.__alfaclassFirebase) {
    const { db, doc, getDoc, setDoc, updateDoc } = window.__alfaclassFirebase;
    const uRef = doc(db, USER_COLLECTION, String(uid));
    const now = new Date();
    const pData = {
      fullName: disp, username, photoUrl: pu || null,
      bio: 'لا يوجد وصف', telegramUserId: uid,
      telegramUsername: tu || null,
      updatedAt: now, lastSeenAt: now, telegramInitializedAt: now,
    };
    try {
      const exists = await getDoc(uRef).then(s => s.exists());
      if (exists) await updateDoc(uRef, pData); else await setDoc(uRef, pData);
      fsResult = { success: true, action: exists ? 'updated' : 'created' };
    } catch (e) { fsResult = { success: false, error: e.message }; }
  } else {
    const appM = await import('https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js');
    const fstM = await import('https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js');
    const fbApp = fstM.getFirestore(appM.initializeApp({
      apiKey: "AIzaSyDrT10AouY-MAtS4Brt-1fPpPt4YoT8spc",
      authDomain: "alfaclass-120e3.firebaseapp.com",
      projectId: "alfaclass-120e3",
      messagingSenderId: "548886375389",
      appId: "1:548886375389:web:a49c2a446981cd2836e434",
    }));
    const { db, doc, getDoc, setDoc, updateDoc } = fbApp;
    const uRef = doc(db, USER_COLLECTION, String(uid));
    const now = new Date();
    const pData = {
      fullName: disp, username, photoUrl: pu || null,
      bio: 'لا يوجد وصف', telegramUserId: uid,
      telegramUsername: tu || null,
      updatedAt: now, lastSeenAt: now, telegramInitializedAt: now,
    };
    try {
      const exists = await getDoc(uRef).then(s => s.exists());
      if (exists) await updateDoc(uRef, pData); else await setDoc(uRef, pData);
      fsResult = { success: true, action: exists ? 'updated' : 'created' };
    } catch (e) { fsResult = { success: false, error: e.message }; }
  }
  setProgress(100);
  const s = {
    telegramUserId: uid,
    fullName: disp,
    firstName: fn,
    lastName: ln,
    username,
    avatarUrl: pu,
    bio: 'لا يوجد وصف',
    telegramUsername: tu,
    source: 'telegram_miniapp',
    timestamp: new Date().toISOString(),
  };
  try { sessionStorage.setItem('alfaclass_session_user', JSON.stringify(s)); } catch (e) {}
  window.__alfaclassUser = s;
  window.__alfaclassTelegramUserId = uid;
  window.location.replace('../index.html?source=telegram');
  return { success: true, payload, firestoreResult: fsResult };
}

const AlfaClassTelegramAuth = {
  start: runAuthFlow,
  getTelegramUserId: () => {
    if (!window.Telegram || !window.Telegram.WebApp?.initDataUnsafe?.user?.id) return null;
    return window.Telegram.WebApp.initDataUnsafe.user.id;
  },
  getSessionUser: () => {
    try { return JSON.parse(sessionStorage.getItem('alfaclass_session_user')); } catch { return null; }
  },
  isAuthenticated: () => { const u = AlfaClassTelegramAuth.getSessionUser(); return !!u && !!u.telegramUserId; },
  getUsername: () => { const u = AlfaClassTelegramAuth.getSessionUser(); return u ? u.username : null; },
};

if (typeof document !== 'undefined') {
  const rd = document.readyState;
  if (rd === 'complete') {
    runAuthFlow().catch(e => { showError(e.message || 'Error', e.stack || ''); });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      runAuthFlow().catch(e => { showError(e.message || 'Error', e.stack || ''); });
    });
  }
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AlfaClassTelegramAuth };
}