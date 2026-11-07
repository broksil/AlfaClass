/**
 * AlfaClass — Telegram Mini App Auto-Authentication Module (100% Frontend-only)
 * Entry point: profile/index.html
 * No backend dependencies — all sync happens client-side via Firebase Firestore SDK.
 */
const USER_COLLECTION = 'users';

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
  return _db;
}

async function syncUserToFirestore(p) {
  if (!_db) await initFirebase();
  const uRef = doc(_db, USER_COLLECTION, String(p.telegramUserId));
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
  } catch (e) { return { success: false, error: e.message }; }
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

function renderUserUI(p, bio) {
  const load = document.getElementById('loading');
  const box = document.getElementById('statusBox');
  const av = document.getElementById('avatar');
  const fn = document.getElementById('fullName');
  const ut = document.getElementById('usernameText');
  const br = document.getElementById('bioRow');
  const err = document.getElementById('err');
  const ur = document.getElementById('usernameRow');
  load.style.display = 'none';
  box.classList.remove('empty');
  if (p.avatarUrl) { av.src = p.avatarUrl; av.style.display = 'block'; } else { av.style.display = 'none'; }
  fn.textContent = p.displayName || 'مستخدم تيليجرام';
  ut.textContent = `@${p.username}`;
  br.textContent = bio || 'لا يوجد وصف في تيليجرام.';
  br.style.color = '#a9a9c9';
  ur.innerHTML = p.telegramUsername
    ? `<span style="color:#7a7a9a;">مستخدم تيليجرام:</span> @${p.telegramUsername}`
    : `<span style="color:#7a7a9a;">اسم المستخدم المولّد:</span> @${p.username}`;
  console.log(`[AlfaClass] User ${p.telegramUserId} authenticated via Telegram.`);
}

async function runAuthFlow() {
  const load = document.getElementById('loading');
  const err = document.getElementById('err');
  load.style.display = 'flex';
  err.classList.remove('visible');

  const user = window.Telegram!.WebApp.initDataUnsafe!.user;
  if (!user || !user.id) throw new Error('Missing Telegram user ID');

  const uid = user.id;
  const fn = user.first_name || 'مستخدم';
  const ln = user.last_name || '';
  const tu = user.username || null;
  const pu = user.photo_url || '';
  const disp = `${fn} ${ln}`.trim();

  const username = generateUsernameWithFallback({ firstName: fn, telegramUserId: uid, username: tu });
  const payload = { telegramUserId: uid, displayName: disp, firstName: fn, lastName: ln, username, avatarUrl: pu, telegramUsername: tu, bio: 'لا يوجد وصف' };

  let fsResult = null;
  try {
    fsResult = await syncUserToFirestore(payload);
    console.log(`[AlfaClass] Firestore sync: ${fsResult.action}`);
  } catch (e) { console.warn(`[AlfaClass] Firestore sync skipped: ${e.message}`); }

  setSessionUser({ telegramUserId: uid, displayName: disp, firstName: fn, lastName: ln, username, avatarUrl: pu, bio: 'لا يوجد وصف', telegramUsername: tu });
  renderUserUI(payload, 'لا يوجد وصف');

  setTimeout(() => window.location.replace('../index.html?source=telegram'), 600);
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
  const start = () => {
    if (window.Telegram && window.Telegram.WebApp) {
      runAuthFlow().catch(e => {
        console.error('[AlfaClass] Auto-start error:', e);
        const el = document.getElementById('err');
        if (el) { el.textContent = 'حدث خطأ غير متوقع أثناء تسجيل الدخول.'; el.classList.add('visible'); }
      });
    }
  };
  if (rd === 'complete') setTimeout(start, 100);
  else document.addEventListener('DOMContentLoaded', start);
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AlfaClassTelegramAuth };
}