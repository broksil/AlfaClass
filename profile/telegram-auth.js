/**
 * AlfaClass — Telegram Mini App Auto-Authentication (Race-Condition Fixed)
 */
const USER_COLLECTION = 'users';

async function syncUserToFirestoreCompat(p) {
  if (typeof firebase === 'undefined') {
    throw new Error('Firebase not initialized — ensure SDKs are loaded before this script.');
  }
  const firebaseApp = firebase.initializeApp({
    apiKey: "AIzaSyDrT10AouY-MAtS4Brt-1fPpPt4YoT8spc",
    authDomain: "alfaclass-120e3.firebaseapp.com",
    projectId: "alfaclass-120e3",
    messagingSenderId: "548886375389",
    appId: "1:548886375389:web:a49c2a446981cd2836e434",
  });
  const db = firebaseApp.firestore();
  const uRef = db.collection(USER_COLLECTION).doc(String(p.telegramUserId));
  const now = new Date();
  const d = {
    fullName: p.displayName, username: p.username, photoUrl: p.avatarUrl || null,
    bio: p.bio || 'لا يوجد وصف', telegramUserId: p.telegramUserId,
    telegramUsername: p.telegramUsername || null,
    updatedAt: now, lastSeenAt: now, telegramInitializedAt: now,
  };
  try {
    const docSnap = await uRef.get();
    if (docSnap.exists()) {
      await uRef.update(d);
    } else {
      await uRef.set(d);
    }
    return { success: true, action: docSnap.exists() ? 'updated' : 'created' };
  } catch (e) {
    throw new Error(`Firestore sync failed: ${e.message}`);
  }
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
  const fsResult = await syncUserToFirestoreCompat(payload);
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