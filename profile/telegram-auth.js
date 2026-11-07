/**
 * AlfaClass — Telegram Mini App Auto-Analytics (100% Frontend-Only)
 */
const USER_COLLECTION = 'users';

function setProgress(percent) {
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = percent + '%';
}

function showError(message, stack) {
  const errEl = document.getElementById('loading-error');
  if (errEl) {
    errEl.textContent = `⚠️ خطأ:${message}\n${stack || ''}`;
    errEl.classList.add('visible');
  }
  console.error('[AlfaClass] Auth CRASH:', message, stack);
}

async function runAuthFlow() {
  setProgress(10);
  if (
    !window.Telegram ||
    !window.Telegram.WebApp ||
    !window.Telegram.WebApp.initDataUnsafe ||
    !window.Telegram.WebApp.initDataUnsafe.user
  ) {
    const err = new Error('⚠️ يرجى فتح الموقع من داخل تطبيق تيليجرام');
    showError(err.message, err.stack);
    throw err;
  }

  setProgress(40);
  try {
    const user = window.Telegram.WebApp.initDataUnsafe.user;
    const uid = user.id;
    const fn = user.first_name || 'مستخدم';
    const ln = user.last_name || '';
    const tu = user.username || null;
    const pu = user.photo_url || '';
    const disp = `${fn} ${ln}`.trim();

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

    // Firestore sync with inline minimal init if window.__alfaclassFirebase not set
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
  } catch (e) {
    showError(e.message || 'Unknown error', e.stack || '');
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
  if (rd === 'complete') {
    runAuthFlow().catch(e => {
      showError(e.message || 'خطأ غير متوقع', e.stack || '');
    });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      runAuthFlow().catch(e => {
        showError(e.message || 'خطأ غير متوقع', e.stack || '');
      });
    });
  }
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AlfaClassTelegramAuth };
}