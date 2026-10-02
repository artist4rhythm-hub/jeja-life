/* 제자의 삶 — 설치·오프라인용 서비스워커
 * 앱 화면 파일은 "인터넷 먼저, 안 되면 저장본" 방식이라 GitHub에 새 파일을 올리면 바로 반영됩니다.
 * 교재 본문·원본 사진·내 표시는 Firestore가 기기에 따로 보관합니다(오프라인 열람). */
const CACHE = 'jesam-v0.14';
const BIBLE = 'jesam-bible-v1'; // 성경 자료는 바뀌지 않으므로 한 번 받으면 기기에 보관
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'backend.js', 'imgedit.js', 'bible.js', 'tts.js', 'firebase-config.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== BIBLE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Firebase SDK·글꼴: 한 번 받으면 저장해 두고 씀
  if (url.hostname === 'www.gstatic.com' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== location.origin) return; // Firestore·로그인 요청은 건드리지 않음
  if (url.pathname.includes('/bible/')) {
    e.respondWith(caches.open(BIBLE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
    return;
  }
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(hit => hit || caches.match('index.html'))));
});
