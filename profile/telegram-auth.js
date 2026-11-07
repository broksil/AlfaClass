/**
 * AlfaClass — Telegram Mini App Auto-Authentication Module (100% Frontend-only)
 */
const USER_COLLECTION = 'users';

function setProgress(percent) {
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = percent + '%';
}

function showError(message) {
  const errEl = document.getElementById('loading-error');
  if (errEl) {
    errEl.textContent = message;
    errEl.classList.add('visible');
  }
  console.error('[AlfaClass] Auth error:', message);
}

let _db = null;
async function initFirebase() {
  const appM = await import('https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js');
  const fstM = await import('https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js');
  _db = fstM.getFirestore(appM.initializeApp({
    apiKey: "AIzaSyDrT10AouY-MAtS4Brt-1fPpPt4YoT8spc",
    authDomain: "alfaclass-120e3.firebaseapp.com",
    projectId: "alfaclass-120e3",
    messagingSenderId: "548886375389",
    appId: "1:548886375389:web:a49c2a446981cd2836e434",
  }));
  return { db: _db, doc: fstM.doc, getDoc: fstM.getDoc, setDoc: fstM.setDoc, updateDoc: fstM.updateDoc };
}
async function syncUserToFirestore(p, firebase) {
  const { db, doc, getDoc, setDoc, updateDoc } = firebase;
  const uRef = doc(db, USER_COLLECTION, String(p.telegramUserId));
  const now = new Date();
  const d = {
    fullName: p.displayName, username: p.username, photoUrl: p.avatarUrl || null,
    bio: p.bio || 'لا يوجد وصف', telegramUserId: p.telegramUserId,
    telegramUsername: p.telegramUsername || null,
    updatedAt: now, lastSeenAt: now, telegramInitializedAt: now,
  };
  try {
    const exists = await getDoc(uRef).then(s => s.exists());
    if (exists) await updateDoc(uRef, d); else await setDoc(uRef, d);
    return { success: true, action: exists ? 'updated' : 'created' };
  } catch (e) { throw new Error(e.message || 'Firestore sync failed'); }
}
function setSessionUser(d) {
  const s = {
    telegramUserId: d.telegramUserId, fullName: d.displayName,
    firstName: d.firstName, lastName: d.lastName,
    username: d.username, avatarUrl: d.avatarUrl,
    bio: d.bio || 'لا يوجد وصف', telegramUsername: d.telegramUsername || null,
    source: 'telegram_miniapp', timestamp: new Date().toISOString(),
  };
  try { sessionStorage.setItem('alfaclass_session_user', JSON.stringify(s)); } catch (e) {}
  window.__alfaclassUser = s;
  window.__alfaclassTelegramUserId = d.telegramUserId;
}
async function runAuthFlow() {
  const safetyTimer = setTimeout(() => {
    window.location.replace('../index.html?source=telegram');
  }, 4000);

  try {
    if (!window.Telegram || !window.Telegram.WebApp) {
      throw new Error('Telegram WebApp not available. Please open this app from Telegram.');
    }
    window.Telegram.WebApp.ready();
    setProgress(20);

    const user = window.Telegram.WebApp.initDataUnsafe?.user;
    if (!user || !user.id) {
      throw new Error('Missing Telegram user ID. Please open this app from Telegram.');
    }

    const uid = user.id;
    const fn = user.first_name || 'مستخدم';
    const ln = user.last_name || '';
    const tu = user.username || null;
    const pu = user.photo_url || '';
    const disp = `${fn} ${ln}`.trim();

    const username = generateUsernameWithFallback({ firstName: fn, telegramUserId: uid, username: tu });
    const payload = { telegramUserId: uid, displayName: disp, firstName: fn, lastName: ln, username, avatarUrl: pu, telegramUsername: tu, bio: 'لا يوجد وصف' };
    setProgress(50);

    const firebase = await initFirebase();
    const fsResult = await syncUserToFirestore(payload, firebase);
    setProgress(80);

    setSessionUser({ telegramUserId: uid, displayName: disp, firstName: fn, lastName: ln, username, avatarUrl: pu, bio: 'لا يوجد وصف', telegramUsername: tu });
    setProgress(100);

    clearTimeout(safetyTimer);
    await new Promise(r => setTimeout(r, 200));
    window.location.replace('../index.html?source=telegram');

    return { success: true, payload, firestoreResult: fsResult };
  } catch (e) {
    clearTimeout(safetyTimer);
    showError(e.message || 'Unknown error occurred');
    setTimeout(() => window.location.replace('../index.html?source=telegram'), 2000);
    throw e;
  }
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
  const start = () => {
    if (window.Telegram && window.Telegram.WebApp) {
      runAuthFlow().catch(e => {
        console.error('[AlfaClass] Auto-start error:', e);
        showError(e.message || 'حدث خطأ غير متوقع أثناء تسجيل الدخول.');
      });
    }
  };
  if (rd === 'complete') setTimeout(start, 100);
  else document.addEventListener('DOMContentLoaded', start);
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AlfaClassTelegramAuth };
}