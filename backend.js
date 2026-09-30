/* 제자의 삶 — 저장소 연결부
 * FirebaseBackend: 로그인 + Firestore (실제 사용)
 * LocalBackend   : 이 기기 저장 + data/ 폴더 (개발·시험용, 주소 끝에 ?local)
 * 두 백엔드는 같은 함수들을 제공하므로 app.js는 어느 쪽인지 몰라도 됩니다.
 */
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';

export async function createBackend() {
  const useLocal = !window.FIREBASE_CONFIG || /[?&]local\b/.test(location.search);
  return useLocal ? LocalBackend() : FirebaseBackend(window.FIREBASE_CONFIG);
}

/* ---------------- Firebase ---------------- */
async function FirebaseBackend(config) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { db = F.getFirestore(app); }
  const d = (...p) => F.doc(db, ...p); const d_ = d;
  let user = null;
  const u = () => { if (!user) throw new Error('로그인이 필요합니다'); return user.uid; };
  const pageCache = new Map();

  return {
    kind: 'firebase',
    onAuth(cb) {
      A.onAuthStateChanged(auth, async fu => {
        user = fu;
        if (!fu) return cb({ state: 'out' });
        let role = null;
        try { const m = await F.getDoc(d('members', fu.uid)); role = m.exists() ? m.data().role : null; } catch (e) { role = null; }
        cb({ state: role ? 'in' : 'nomember', uid: fu.uid, name: fu.displayName || fu.email, email: fu.email, role });
      });
      A.getRedirectResult(auth).catch(() => {});
    },
    async signIn() {
      const p = new A.GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' });
      try { await A.signInWithPopup(auth, p); }
      catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) return A.signInWithRedirect(auth, p);
        throw e;
      }
    },
    signOut: () => A.signOut(auth),

    async getIndex() { const s = await F.getDoc(d('lessons', '_index')); return s.exists() ? JSON.parse(s.data().json) : null; },
    async getLesson(lid) { const s = await F.getDoc(d('lessons', lid)); if (!s.exists()) throw new Error(lid + ' 데이터가 없습니다'); return JSON.parse(s.data().json); },
    async pageUrl(p) {
      if (pageCache.has(p)) return pageCache.get(p);
      const s = await F.getDoc(d('pages', 'p' + p)); const v = s.exists() ? s.data().img : null;
      pageCache.set(p, v); return v;
    },

    async loadUser() {
      const uid = u(); const out = { marks: [], answers: {}, done: {}, prefs: {} };
      const [m, a, dn, pf] = await Promise.all(['marks', 'answers', 'done'].map(c => F.getDocs(F.collection(db, 'users', uid, c))).concat([F.getDoc(d('users', uid, 'prefs', 'main'))]));
      m.forEach(x => { const g = x.data(); (g.segs || []).forEach((s, i) => out.marks.push({ id: x.id + '-' + i, gid: x.id, lid: g.lid, block: s.block, s: s.s, e: s.e, quote: s.quote, c: g.c, note: i === 0 ? (g.note || '') : '', photos: i === 0 ? (g.photos || []) : [], at: g.at })); });
      a.forEach(x => { out.answers[x.id] = x.data(); });
      dn.forEach(x => { out.done[x.id] = x.data().at; });
      if (pf.exists()) out.prefs = pf.data();
      return out;
    },
    saveMark: (gid, g) => F.setDoc(d('users', u(), 'marks', gid), g),
    deleteMark: gid => F.deleteDoc(d('users', u(), 'marks', gid)),
    setAnswer: (id, t) => t ? F.setDoc(d('users', u(), 'answers', id), { t, at: Date.now() }) : F.deleteDoc(d('users', u(), 'answers', id)),
    setDone: (id, v) => v ? F.setDoc(d('users', u(), 'done', id), { at: Date.now() }) : F.deleteDoc(d('users', u(), 'done', id)),
    setPrefs: p => F.setDoc(d('users', u(), 'prefs', 'main'), p),

    // 실시간: 내 형광펜·메모·답·진도가 다른 기기에서 바뀌면 바로 알려줌
    watchUser(cb) {
      const uid = u(); const offs = [];
      offs.push(F.onSnapshot(F.collection(db, 'users', uid, 'marks'), snap => {
        const marks = []; snap.forEach(x => { const g = x.data(); (g.segs || []).forEach((s, i) => marks.push({ id: x.id + '-' + i, gid: x.id, lid: g.lid, block: s.block, s: s.s, e: s.e, quote: s.quote, c: g.c, note: i === 0 ? (g.note || '') : '', photos: i === 0 ? (g.photos || []) : [], at: g.at })); });
        cb({ marks });
      }, e => console.error('marks', e)));
      offs.push(F.onSnapshot(F.collection(db, 'users', uid, 'answers'), snap => { const answers = {}; snap.forEach(x => { answers[x.id] = x.data(); }); cb({ answers }); }, e => console.error('answers', e)));
      offs.push(F.onSnapshot(F.collection(db, 'users', uid, 'done'), snap => { const done = {}; snap.forEach(x => { done[x.id] = x.data().at; }); cb({ done }); }, e => console.error('done', e)));
      return () => offs.forEach(f => f());
    },
    watchAtts(lid, cb) {
      return F.onSnapshot(F.collection(db, 'lessons', lid, 'attachments'), snap => {
        const out = []; snap.forEach(x => out.push({ ...x.data(), id: x.id, lid })); cb(out.sort((a, b) => a.at - b.at));
      }, e => console.error('atts', e));
    },
    async listAtts(lid) {
      const s = await F.getDocs(F.collection(db, 'lessons', lid, 'attachments'));
      const out = []; s.forEach(x => out.push({ ...x.data(), id: x.id, lid })); return out.sort((a, b) => a.at - b.at);
    },
    async addAtt(a) { const { id, lid, ...rest } = a; await F.setDoc(d('lessons', lid, 'attachments', id), { ...rest, author: u() }); },
    removeAtt: a => F.deleteDoc(d('lessons', a.lid, 'attachments', a.id)),

    // 메모 사진 (한 장씩 따로 저장 — 문서 용량 제한 때문)
    putPhoto: (id, d) => F.setDoc(d_('users', u(), 'photos', id), d),
    async getPhoto(id) { const s = await F.getDoc(d_('users', u(), 'photos', id)); return s.exists() ? s.data().img : null; },
    deletePhoto: id => F.deleteDoc(d_('users', u(), 'photos', id)),

    // 관리자: 교재 올리기
    putIndex: obj => F.setDoc(d('lessons', '_index'), { json: JSON.stringify(obj), at: Date.now() }),
    putLesson: (lid, obj) => F.setDoc(d('lessons', lid), { json: JSON.stringify(obj), at: Date.now() }),
    putPage: (p, lid, dataUrl) => { pageCache.delete(p); return F.setDoc(d('pages', 'p' + p), { lid: lid || '', img: dataUrl, at: Date.now() }); }
  };
}

/* ---------------- 로컬(시험용) ---------------- */
function LocalBackend() {
  const K = 'dl.local';
  const load = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } };
  const db = Object.assign({ marks: {}, answers: {}, done: {}, prefs: {}, atts: {} }, load());
  const save = () => { try { localStorage.setItem(K, JSON.stringify(db)); } catch (e) { console.warn('저장 공간 부족'); } return Promise.resolve(); };
  return {
    kind: 'local',
    onAuth(cb) { cb({ state: 'in', uid: 'local', name: '이 기기', role: 'admin' }); },
    signIn: async () => {}, signOut: async () => {},
    getIndex: () => fetch('data/index.json').then(r => r.json()),
    getLesson: lid => fetch(`data/${lid}.json`).then(r => { if (!r.ok) throw new Error(lid + ' 데이터가 없습니다'); return r.json(); }),
    pageUrl: async p => `pages/p${p}.webp`,
    async loadUser() {
      const out = { marks: [], answers: { ...db.answers }, done: { ...db.done }, prefs: { ...db.prefs } };
      Object.entries(db.marks).forEach(([gid, g]) => g.segs.forEach((s, i) => out.marks.push({ id: gid + '-' + i, gid, lid: g.lid, block: s.block, s: s.s, e: s.e, quote: s.quote, c: g.c, note: i === 0 ? (g.note || '') : '', photos: i === 0 ? (g.photos || []) : [], at: g.at })));
      return out;
    },
    saveMark: (gid, g) => { db.marks[gid] = g; return save(); },
    deleteMark: gid => { delete db.marks[gid]; return save(); },
    setAnswer: (id, t) => { if (t) db.answers[id] = { t, at: Date.now() }; else delete db.answers[id]; return save(); },
    setDone: (id, v) => { if (v) db.done[id] = Date.now(); else delete db.done[id]; return save(); },
    setPrefs: p => { db.prefs = p; return save(); },
    putPhoto: (id, d) => { db.photos = db.photos || {}; db.photos[id] = d; return save(); },
    getPhoto: async id => ((db.photos || {})[id] || {}).img || null,
    deletePhoto: id => { if (db.photos) delete db.photos[id]; return save(); },
    watchUser: () => () => {},
    watchAtts: () => () => {},
    listAtts: async lid => Object.values(db.atts).filter(a => a.lid === lid).sort((a, b) => a.at - b.at),
    addAtt: a => { db.atts[a.id] = { ...a, author: 'local' }; return save(); },
    removeAtt: a => { delete db.atts[a.id]; return save(); },
    putIndex: async () => { throw new Error('로컬 시험 모드에서는 교재를 올릴 수 없습니다'); },
    putLesson: async () => { throw new Error('로컬 시험 모드에서는 교재를 올릴 수 없습니다'); },
    putPage: async () => { throw new Error('로컬 시험 모드에서는 교재를 올릴 수 없습니다'); }
  };
}
