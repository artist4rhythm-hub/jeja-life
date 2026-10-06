/* 제자의 삶 — 저장소 연결부
 * FirebaseBackend: 로그인 + Firestore (실제 사용)
 * LocalBackend   : 이 기기 저장 + data/ 폴더 (개발·시험용, 주소 끝에 ?local)
 * 두 백엔드는 같은 함수들을 제공하므로 app.js는 어느 쪽인지 몰라도 됩니다.
 */
import { device } from './tts.js';
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const devInfo = () => { try { return device().label.slice(0, 90); } catch (e) { return '알 수 없음'; } };

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
  let myRole = null;

  // 접속 기록: 로그인(앱 열기)할 때마다 한 줄. 같은 기기에서 30분 안에 다시 열면 중복으로 남기지 않음
  async function logLogin(fu, role, kind) {
    try {
      const k = 'jesam.log.' + fu.uid + '.' + kind; let last = 0;
      try { last = +localStorage.getItem(k) || 0; } catch (e) {}
      if (Date.now() - last < 30 * 60 * 1000) return;
      const at = Date.now(), dev = devInfo();
      await F.addDoc(F.collection(db, 'loginLogs'), { uid: fu.uid, email: (fu.email || '').toLowerCase(), name: (fu.displayName || fu.email || '').slice(0, 90), role: role || '', kind, dev, at });
      if (role) await F.updateDoc(d('members', fu.uid), { lastLogin: at, lastDev: dev, loginCount: F.increment(1) }).catch(e => console.warn('lastLogin', e));
      try { localStorage.setItem(k, String(at)); } catch (e) {}
    } catch (e) { console.warn('loginLog', e); }
  }
  // 자료 목록: 권한에 맞는 것만 불러오기 (관리자 = 전부 / 강사 = 내 것 + 강사 공개 + 전체 공개 / 훈련생 = 전체 공개)
  function attQueries(lid) {
    const col = F.collection(db, 'lessons', lid, 'attachments');
    if (myRole === 'admin') return [col];
    const qs = [F.query(col, F.where('vis', '==', 'all')), F.query(col, F.where('author', '==', u()))];
    if (myRole === 'teacher') qs.push(F.query(col, F.where('vis', '==', 'teachers')));
    return qs;
  }
  const attSort = map => [...map.values()].sort((a, b) => a.at - b.at);

  return {
    kind: 'firebase',
    onAuth(cb) {
      A.onAuthStateChanged(auth, async fu => {
        user = fu;
        if (!fu) return cb({ state: 'out' });
        let role = null, reason = 'none';
        try { const m = await F.getDoc(d('members', fu.uid)); role = m.exists() ? m.data().role : null; } catch (e) { role = null; }
        // 아직 회원이 아니면: 관리자가 등록해 둔 초대(구글 메일)가 있는지 확인하고 자동 가입
        if (!role && fu.email) {
          try {
            const key = fu.email.toLowerCase(); const inv = await F.getDoc(d('invites', key));
            if (inv.exists() && inv.data().active) {
              const r = inv.data().role || 'member';
              await F.setDoc(d('members', fu.uid), { role: r, email: key, name: inv.data().name || fu.displayName || key, joinedAt: Date.now(), via: 'invite' });
              await F.updateDoc(d('invites', key), { uid: fu.uid, joinedAt: Date.now() }).catch(() => {});
              role = r;
            } else if (inv.exists()) reason = 'stopped';
          } catch (e) { console.warn('invite', e); }
        }
        myRole = role;
        logLogin(fu, role, role ? 'in' : reason === 'stopped' ? 'stopped' : 'denied');
        cb({ state: role ? 'in' : 'nomember', reason, uid: fu.uid, name: fu.displayName || fu.email, email: fu.email, role });
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

    // 서재: 교재 목록 (lessons/_library) · 교재별 목차 (lessons/_index = 제자의 삶, lessons/_index_cs … = 새 교재)
    async getLibrary() { try { const s = await F.getDoc(d('lessons', '_library')); return s.exists() ? JSON.parse(s.data().json) : null; } catch (e) { return null; } },
    putLibrary: list => F.setDoc(d('lessons', '_library'), { json: JSON.stringify(list), at: Date.now() }),
    async getIndex(doc = '_index') { try { const s = await F.getDoc(d('lessons', doc)); return s.exists() ? JSON.parse(s.data().json) : null; } catch (e) { if (e.code === 'permission-denied') return null; throw e; } },
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
      const qs = attQueries(lid); const parts = qs.map(() => new Map()); const ready = qs.map(() => false);
      const emit = () => { if (!ready.every(Boolean)) return; const all = new Map(); parts.forEach(p => p.forEach((v, k) => all.set(k, v))); cb(attSort(all)); };
      const offs = qs.map((q, i) => F.onSnapshot(q, snap => {
        parts[i] = new Map(); snap.forEach(x => parts[i].set(x.id, { ...x.data(), id: x.id, lid })); ready[i] = true; emit();
      }, e => { console.error('atts', e); ready[i] = true; emit(); }));
      return () => offs.forEach(f => f());
    },
    async listAtts(lid) {
      const snaps = await Promise.all(attQueries(lid).map(q => F.getDocs(q).catch(e => { console.warn('atts', e); return null; })));
      const all = new Map(); snaps.forEach(s => s && s.forEach(x => all.set(x.id, { ...x.data(), id: x.id, lid }))); return attSort(all);
    },
    async addAtt(a) { const { id, lid, ...rest } = a; await F.setDoc(d('lessons', lid, 'attachments', id), { ...rest, author: u() }); },
    updateAtt: (a, patch) => F.updateDoc(d('lessons', a.lid, 'attachments', a.id), patch),
    removeAtt: a => F.deleteDoc(d('lessons', a.lid, 'attachments', a.id)),
    // 관리자: 공개 설정이 없던 예전 자료에 '전체 공개'를 붙여 줌 (예전처럼 모두에게 보이도록) — 한 번만 실행
    async migrateAttVis(lids) {
      let n = 0;
      for (const lid of lids) {
        const s = await F.getDocs(F.collection(db, 'lessons', lid, 'attachments'));
        const todo = []; s.forEach(x => { if (!x.data().vis) todo.push(F.updateDoc(x.ref, { vis: 'all' })); });
        await Promise.all(todo); n += todo.length;
      }
      return n;
    },

    // 메모 사진 (한 장씩 따로 저장 — 문서 용량 제한 때문)
    putPhoto: (id, d) => F.setDoc(d_('users', u(), 'photos', id), d),
    async getPhoto(id) { const s = await F.getDoc(d_('users', u(), 'photos', id)); return s.exists() ? s.data().img : null; },
    deletePhoto: id => F.deleteDoc(d_('users', u(), 'photos', id)),

    // 관리자: 사용자 관리 (구글 메일 초대)
    async listPeople() {
      const [iv, mb] = await Promise.all([F.getDocs(F.collection(db, 'invites')), F.getDocs(F.collection(db, 'members'))]);
      const invites = [], members = [];
      iv.forEach(x => invites.push({ ...x.data(), id: x.id })); mb.forEach(x => members.push({ ...x.data(), uid: x.id }));
      return { invites, members, me: u() };
    },
    saveInvite: (email, data) => F.setDoc(d('invites', email.toLowerCase()), data, { merge: true }),
    deleteInvite: email => F.deleteDoc(d('invites', email.toLowerCase())),
    setMemberRole: (uid, role) => F.updateDoc(d('members', uid), { role }),
    removeMember: uid => F.deleteDoc(d('members', uid)),
    // 관리자: 접속 기록 (최신순, 한 번에 300줄씩)
    async listLogs(after) {
      const parts = [F.collection(db, 'loginLogs'), F.orderBy('at', 'desc')];
      if (after) parts.push(F.startAfter(after));
      parts.push(F.limit(300));
      const s = await F.getDocs(F.query(...parts)); const out = []; s.forEach(x => out.push({ ...x.data(), id: x.id }));
      return out;
    },

    // 관리자: 교재 올리기
    // access: 'all'(모든 사용자) | 'staff'(강사·관리자만) — 보안 규칙이 이 값으로 읽기를 막음
    putIndex: (obj, doc = '_index', access = 'all') => F.setDoc(d('lessons', doc), { json: JSON.stringify(obj), access, at: Date.now() }),
    putLesson: (lid, obj, access = 'all') => F.setDoc(d('lessons', lid), { json: JSON.stringify(obj), access, at: Date.now() }),
    // 번역: lessons/{과}/tr/{언어} { json, access }
    async getTr(lid, lang) { try { const x = await F.getDoc(d('lessons', lid, 'tr', lang)); return x.exists() ? JSON.parse(x.data().json) : null; } catch (e) { if (e.code === 'permission-denied') return null; throw e; } },
    putTr: (lid, lang, obj, access = 'all') => F.setDoc(d('lessons', lid, 'tr', lang), { json: JSON.stringify(obj), access, at: Date.now() }),
    putPage: (p, lid, dataUrl, access = 'all') => { pageCache.delete(p); return F.setDoc(d('pages', 'p' + p), { lid: lid || '', img: dataUrl, access, at: Date.now() }); },
    // 관리자: 교재 공개 대상 바꾸기 (목차·본문·원본 사진 문서에 모두 표시)
    async setBookAccess(indexDoc, lids, pages, access, onStep, langs = []) {
      const ids = [['lessons', indexDoc], ...lids.map(l => ['lessons', l]), ...pages.map(p => ['pages', 'p' + p])];
      const trIds = lids.flatMap(l => langs.map(g => [l, g]));
      let n = 0;
      for (let i = 0; i < ids.length; i += 10) {
        await Promise.all(ids.slice(i, i + 10).map(([c, id]) => F.updateDoc(d(c, id), { access }).catch(e => { if (e.code !== 'not-found') throw e; })));
        n = Math.min(ids.length, i + 10); onStep && onStep(n, ids.length);
      }
      await Promise.all(trIds.map(([l, g]) => F.updateDoc(d('lessons', l, 'tr', g), { access }).catch(e => { if (e.code !== 'not-found') throw e; })));
    }
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
    onAuth(cb) { cb({ state: 'in', uid: 'local', name: '이 기기', role: (location.search.match(/role=(\w+)/) || [0, 'admin'])[1] }); },
    signIn: async () => {}, signOut: async () => {},
    getLibrary: () => fetch('data/library.json').then(r => r.ok ? r.json() : null).catch(() => null),
    putLibrary: async () => {},
    getIndex: (doc = '_index') => fetch(`data/${doc === '_index' ? 'index' : 'index' + doc.slice(6)}.json`).then(r => r.ok ? r.json() : null),
    setBookAccess: async () => {},
    getTr: (lid, lang) => fetch(`data/tr/tr_${lang}_${lid}.json`).then(r => r.ok ? r.json() : null).catch(() => null),
    putTr: async () => {},
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
    updateAtt: (a, patch) => { Object.assign(db.atts[a.id] || {}, patch); return save(); },
    migrateAttVis: async () => 0,
    listLogs: async () => [
      { id: 'x1', uid: 'local', email: 'me@example.com', name: '이 기기', role: 'admin', kind: 'in', dev: devInfo(), at: Date.now() - 60000 },
      { id: 'x2', uid: 't1', email: 'teacher@gmail.com', name: '김강사', role: 'teacher', kind: 'in', dev: '아이패드 · 홈 화면 앱', at: Date.now() - 86400000 },
      { id: 'x3', uid: 'z9', email: 'stranger@gmail.com', name: '모르는 사람', role: '', kind: 'denied', dev: '안드로이드 · Chrome', at: Date.now() - 2 * 86400000 }],
    removeAtt: a => { delete db.atts[a.id]; return save(); },
    async listPeople() { return { invites: Object.values(db.invites || {}), members: [{ uid: 'local', role: 'admin', name: '이 기기', email: 'me@example.com', lastLogin: Date.now() - 60000, loginCount: 12, lastDev: devInfo() }, { uid: 't1', role: 'teacher', name: '김강사', email: 'teacher@gmail.com', lastLogin: Date.now() - 86400000, loginCount: 3, lastDev: '아이패드 · 홈 화면 앱' }], me: 'local' }; },
    saveInvite: (email, data) => { db.invites = db.invites || {}; const k = email.toLowerCase(); db.invites[k] = { ...(db.invites[k] || {}), ...data, id: k }; return save(); },
    deleteInvite: email => { if (db.invites) delete db.invites[email.toLowerCase()]; return save(); },
    setMemberRole: async () => {}, removeMember: async () => {},
    putIndex: async () => { throw new Error('로컬 시험 모드에서는 교재를 올릴 수 없습니다'); },
    putLesson: async () => { throw new Error('로컬 시험 모드에서는 교재를 올릴 수 없습니다'); },
    putPage: async () => { throw new Error('로컬 시험 모드에서는 교재를 올릴 수 없습니다'); }
  };
}
