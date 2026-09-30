/* 제자의 삶 — 음성 듣기 (기기에 들어 있는 목소리 사용: 무료 · 저장 용량 0)
 * 브라우저의 Web Speech API(speechSynthesis)로 본문을 문장 단위로 읽습니다.
 * 읽는 문장은 본문에 표시되고, 폰에서는 한 단원이 끝나면 다음 단원으로 넘어갑니다.
 * 목소리는 기기마다 다르므로 '목소리 설정' 창에 기기별 좋은 목소리 설치 방법을 안내합니다. */
import { parseRef, loadBooks } from './bible.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const synth = window.speechSynthesis || null;
const LS = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const RATES = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5];

/* ---------------- 기기 알아보기 ---------------- */
export function device() {
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const os = /iPad/.test(ua) || iPadOS ? 'ipad' : /iPhone|iPod/.test(ua) ? 'iphone' : /Android/.test(ua) ? 'android'
    : /CrOS/.test(ua) ? 'chromebook' : /Mac OS X/.test(ua) ? 'mac' : /Windows/.test(ua) ? 'windows' : 'other';
  const br = /Edg(e|A|iOS)?\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? '삼성 인터넷' : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '브라우저';
  const app = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  const OSKO = { ipad: '아이패드', iphone: '아이폰', android: '안드로이드', chromebook: '크롬북', mac: '맥', windows: '윈도우 PC', other: '기타 기기' };
  return { os, br, app: !!app, label: `${OSKO[os]} · ${app ? '홈 화면 앱' : br}` };
}

/* ---------------- 목소리 품질 ---------------- */
const KNOWN = { SunHi: '선희 · 여', InJoon: '인준 · 남', Hyunsu: '현수 · 남', Heami: '해미 · 여', Yuna: '유나 · 여', Minsu: '민수 · 남', Jian: '지안', Suhyun: '수현', Sora: '소라' };
function score(v) {
  const n = v.name;
  if (/Natural|Neural/i.test(n)) return 4;
  if (/Premium|프리미엄/i.test(n)) return 3.5;
  if (/Enhanced|향상/i.test(n)) return 3;
  if (/Google/i.test(n)) return 2.5;
  if (/Online/i.test(n)) return 2.5;
  return 1;
}
const stars = s => s >= 3 ? ['★★★', '매우 자연스러움'] : s >= 2.5 ? ['★★', '자연스러움'] : ['★', '기본 음성'];
function niceName(v) {
  const k = Object.keys(KNOWN).find(k => v.name.includes(k));
  const base = v.name.replace(/^Microsoft\s+/, '').replace(/\s*-\s*Korean.*$/i, '').replace(/\s*\(Natural\)/i, '').replace(/\s+Online/i, '').trim();
  return k ? `${KNOWN[k]} (${base})` : base;
}

/* ---------------- 읽을 문장 만들기 ---------------- */
let bookKo = null;
async function ensureBooks() { if (bookKo) return; try { const b = await loadBooks(); bookKo = {}; b.forEach(x => bookKo[x.id] = x.ko); } catch (e) { bookKo = {}; } }
const REF_RE = /((?:[1-3]\s?)?[가-힣]{1,7})\s?(\d{1,3})\s?[:;]\s?(\d{1,3})(?:\s?[-~]\s?(\d{1,3}))?/g;
function sayRef(name, c, v, v2) {
  if (+v < 1) return null;
  for (let i = 0; i < name.length; i++) {
    const tail = name.slice(i); if (i > 0 && tail.length < 2) break;   // "오전 9:00" 같은 시각은 성경 구절이 아님
    const r = parseRef(`${tail} ${c}:${v}`);
    if (r && bookKo && bookKo[r.bk]) return `${name.slice(0, i)} ${bookKo[r.bk]} ${c}장 ${v}절${v2 ? `에서 ${v2}절` : ''}`;
  }
  return null;
}
export function speakify(s) {
  return String(s)
    .replace(REF_RE, (all, name, c, v, v2) => sayRef(name, c, v, v2) || all)
    .replace(/[✓✔✝†•※★☆▶►◆◇■□○●◎⏎*_#]/g, ' ')
    .replace(/(\d)\s?~\s?(\d)/g, '$1에서 $2')
    .replace(/\s+/g, ' ').trim();
}
/* 문장 나누기: 마침표·물음표 뒤에서 자르고, 너무 길면 쉼표·띄어쓰기에서 한 번 더 자름 (크롬의 긴 문장 멈춤 방지) */
function sentences(text) {
  const out = []; const re = /[^.!?…。]+(?:[.!?…。]+["'”’)\]]*)?\s*/g; let m;
  while ((m = re.exec(text))) {
    if (!m[0]) { re.lastIndex++; continue; }
    let s = m.index, e = m.index + m[0].length;
    while (e - s > 130) {
      const seg = text.slice(s, s + 130); let cut = Math.max(seg.lastIndexOf(', '), seg.lastIndexOf('， '));
      if (cut < 50) cut = seg.lastIndexOf(' '); if (cut < 40) cut = 120;
      out.push([s, s + cut + 1]); s = s + cut + 1;
    }
    out.push([s, e]);
  }
  return out.filter(([s, e]) => text.slice(s, e).trim());
}
function chunksOf(el) {
  const tx = el.querySelector('.tx'); if (!tx) return [];
  const id = el.dataset.id, text = tx.textContent, out = [];
  const ref = el.querySelector(':scope > .vref');
  if (ref) { const r = parseRef(ref.dataset.ref); const t = r && bookKo && bookKo[r.bk] ? `${bookKo[r.bk]} ${r.ch}장 ${r.v1 ? r.v1 + '절' : ''}${r.v2 && r.v2 !== r.v1 ? `에서 ${r.v2}절` : ''}` : speakify(ref.dataset.ref); out.push({ id, s: 0, e: 0, say: t }); }
  sentences(text).forEach(([s, e]) => { const say = speakify(text.slice(s, e)); if (say) out.push({ id, s, e, say }); });
  return out;
}

/* ---------------- 본문 표시 ---------------- */
const HL = typeof CSS !== 'undefined' && CSS.highlights && window.Highlight;
function rangeFor(tx, s, e) {
  const w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT); let pos = 0, r = document.createRange(), started = false, n;
  while ((n = w.nextNode())) {
    const len = n.textContent.length;
    if (!started && s <= pos + len) { r.setStart(n, Math.max(0, s - pos)); started = true; }
    if (started && e <= pos + len) { r.setEnd(n, Math.max(0, e - pos)); return r; }
    pos += len;
  }
  return started ? r : null;
}

/* ---------------- 기기별 안내문 ---------------- */
const GUIDE = [
  { os: ['ipad', 'iphone'], title: '아이패드 · 아이폰', html: `
    <ol>
      <li><b>설정</b> 앱을 엽니다.</li>
      <li><b>손쉬운 사용</b> → <b>읽기 및 말하기</b> → <b>음성</b>을 누릅니다.</li>
      <li>언어 목록에서 <b>한국어</b>를 누릅니다.</li>
      <li><b>유나(Yuna)</b> 같은 목소리를 누르고, 이름 옆에 <b>(향상된 품질)</b> 또는 <b>(프리미엄)</b>이라고 쓰인 것을 골라 <b>구름(↓) 표시</b>를 눌러 내려받습니다. 수백 MB라 <b>와이파이</b>에서 받으세요.</li>
      <li>다 받아지면 이 앱을 <b>완전히 닫았다가</b>(화면 아래에서 위로 밀어 올려 앱 카드를 위로 넘김) 다시 엽니다.</li>
      <li><b>🔊 듣기 → ⚙ 목소리 설정</b>에서 ‘향상된’ 또는 ‘프리미엄’이 붙은 목소리를 고릅니다.</li>
    </ol>
    <p class="tip">‘Siri 목소리’는 보안 때문에 웹 앱에서 쓸 수 없습니다. 향상된·프리미엄 목소리가 가장 좋습니다.<br>화면이 꺼지면 읽기가 멈출 수 있습니다. 듣는 동안은 화면이 꺼지지 않게 해 두었습니다.</p>` },
  { os: ['mac'], title: '맥 (MacBook · iMac)', html: `
    <p><b>가장 쉬운 방법: Microsoft Edge 브라우저</b>로 이 앱 주소를 열면 사람 목소리에 가까운 <b>선희·인준·현수</b> 목소리가 따로 설치하지 않아도 목록에 나옵니다(인터넷 연결 필요).</p>
    <p>Safari나 Chrome에서 쓰려면 맥에 좋은 목소리를 내려받습니다.</p>
    <ol>
      <li>화면 왼쪽 위 <b> 메뉴 → 시스템 설정</b>을 엽니다.</li>
      <li>왼쪽에서 <b>손쉬운 사용</b> → 오른쪽에서 <b>읽기 및 말하기</b>를 누릅니다.</li>
      <li><b>시스템 음성</b> 옆의 <b>ⓘ</b>(또는 목록 맨 아래 <b>음성 관리…</b>)를 누릅니다.</li>
      <li>언어 목록에서 <b>한국어</b>를 찾아 <b>유나(향상된 품질)</b> 또는 <b>(프리미엄)</b> 옆의 <b>내려받기(↓)</b>를 누릅니다.</li>
      <li>다 받아지면 브라우저를 <b>완전히 종료(⌘Q)</b>했다가 다시 열고, <b>⚙ 목소리 설정</b>에서 고릅니다.</li>
    </ol>` },
  { os: ['windows'], title: '윈도우 PC', html: `
    <ol>
      <li>윈도우에 기본으로 들어 있는 <b>Microsoft Edge</b> 브라우저를 엽니다.</li>
      <li>주소창에 이 앱 주소를 넣고 로그인합니다. (Chrome에서 쓰던 주소 그대로)</li>
      <li><b>🔊 듣기 → ⚙ 목소리 설정</b>에 <b>선희(SunHi) · 인준(InJoon) · 현수(Hyunsu)</b>가 ★★★로 나옵니다. 따로 설치할 것이 없습니다.</li>
    </ol>
    <p class="tip">이 목소리는 인터넷으로 만들어지므로 인터넷이 연결되어 있어야 합니다. Chrome에서는 ‘Google 한국의’ 목소리(★★)를 쓸 수 있습니다.</p>` },
  { os: ['android', 'chromebook'], title: '안드로이드 폰·태블릿 (갤럭시 등)', html: `
    <ol>
      <li><b>Play 스토어</b>에서 <b>‘Google 음성 인식 및 합성’(Speech Services by Google)</b>을 검색해 설치(또는 업데이트)합니다.</li>
      <li><b>설정</b> 앱 → 검색창에 <b>‘텍스트 음성 변환’</b>(또는 ‘TTS’)을 검색해 엽니다.<br><small>갤럭시: 설정 → 일반 → 글자 읽어주기(TTS) / 다른 폰: 설정 → 시스템 → 언어 및 입력 → 텍스트 음성 변환 출력</small></li>
      <li><b>기본 엔진</b>을 <b>Google 음성 인식 및 합성</b>으로 고릅니다.</li>
      <li>엔진 옆 <b>⚙</b> → <b>음성 데이터 설치</b> → <b>한국어</b>를 눌러 마음에 드는 목소리(음성 1~4)를 고르고 내려받습니다.</li>
      <li>Chrome으로 이 앱을 다시 열고 <b>🔊 듣기</b>를 누릅니다.</li>
    </ol>
    <p class="tip">안드로이드 Chrome은 목록에 목소리가 하나만 보일 수 있습니다. 그럴 때는 위 4번에서 고른 목소리로 읽습니다.</p>` }
];

/* ---------------- 플레이어 ---------------- */
export function initTTS(opt) {
  /* opt: { getStart(): Element, getBlocks(startEl): Element[], onEnd(): Promise<boolean>, toast(msg), getRate(), setRate(v), where(el): string } */
  const bar = $('#tts'), modal = $('#ttsm'), btn = $('#btn-tts');
  let voices = [], voice = null, queue = [], qi = 0, playing = false, token = 0, lastBlock = null, keep = null, lock = null, advancing = false;
  const rate = () => opt.getRate() || 1;

  function loadVoices() {
    if (!synth) return;
    voices = synth.getVoices().filter(v => /^ko/i.test(v.lang) || /Korean|한국/.test(v.name))
      .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
    const want = LS.get('jesam.tts.voice');
    voice = voices.find(v => v.voiceURI === want) || voices[0] || null;
    $('#tts-voice').textContent = voice ? niceName(voice) : '기본 목소리';
    if (!modal.hidden) renderModal();
  }
  if (synth) { loadVoices(); synth.addEventListener ? synth.addEventListener('voiceschanged', loadVoices) : (synth.onvoiceschanged = loadVoices); }

  function clearMark() {
    if (HL) CSS.highlights.delete('tts');
    document.querySelectorAll('.tts-on').forEach(x => x.classList.remove('tts-on'));
  }
  function mark(c) {
    const el = document.querySelector(`#reader [data-id="${c.id}"]`); if (!el) return;
    if (lastBlock !== el) { document.querySelectorAll('.tts-on').forEach(x => x.classList.remove('tts-on')); el.classList.add('tts-on'); lastBlock = el;
      const r = el.getBoundingClientRect(); if (r.top < 110 || r.bottom > innerHeight - 150) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    if (HL) { CSS.highlights.delete('tts'); const tx = el.querySelector('.tx'); if (tx && c.e > c.s) { const r = rangeFor(tx, c.s, c.e); if (r) CSS.highlights.set('tts', new Highlight(r)); } }
    $('#tts-where').textContent = opt.where(el) || '';
  }
  function speak(i) {
    const my = ++token;
    if (i >= queue.length) { finish(); return; }
    if (i < 0) i = 0;
    qi = i; const c = queue[i]; mark(c);
    const u = new SpeechSynthesisUtterance(c.say);
    u.lang = voice ? voice.lang : 'ko-KR'; if (voice) u.voice = voice; u.rate = rate();
    u.onend = () => { if (my === token && playing) speak(i + 1); };
    u.onerror = e => {
      if (my !== token || e.error === 'interrupted' || e.error === 'canceled') return;
      if (e.error === 'network' || e.error === 'synthesis-unavailable') { opt.toast('이 목소리는 인터넷이 필요합니다. 연결을 확인하거나 다른 목소리를 골라 주세요'); pause(); return; }
      if (e.error === 'not-allowed') { pause(); opt.toast('▶ 를 한 번 눌러 주세요'); return; }
      if (playing) speak(i + 1);
    };
    if (synth.speaking || synth.pending) { synth.cancel(); setTimeout(() => { if (my === token && playing) synth.speak(u); }, 80); }
    else synth.speak(u);
  }
  async function finish() {
    if (advancing) return; advancing = true;
    try {
      const more = await opt.onEnd();
      if (more && playing) { queue = []; lastBlock = null; await build(opt.getStart(true)); if (queue.length) { speak(0); return; } }
    } finally { advancing = false; }
    pause(); clearMark(); qi = 0; opt.toast('다 읽었습니다');
  }
  async function build(start) {
    await ensureBooks();
    queue = opt.getBlocks(start).flatMap(chunksOf); qi = 0;
  }
  function setPlayUI() {
    $('#tts-play').textContent = playing ? '⏸' : '▶'; $('#tts-play').setAttribute('aria-label', playing ? '잠시 멈춤' : '재생');
    bar.classList.toggle('playing', playing);
  }
  async function wake(on) {
    try { if (on && 'wakeLock' in navigator && !lock) { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } else if (!on && lock) { await lock.release(); lock = null; } } catch (e) { lock = null; }
  }
  function play() {
    if (!synth) { opt.toast('이 브라우저는 음성 듣기를 지원하지 않습니다'); return; }
    if (!queue.length) return;
    playing = true; setPlayUI(); speak(qi); wake(true);
    // 크롬의 구글 목소리는 오래 읽으면 멈추는 문제가 있어 10초마다 살짝 깨워 줌
    clearInterval(keep); if (voice && /Google/.test(voice.name) && !/Android/.test(navigator.userAgent)) keep = setInterval(() => { if (playing && synth.speaking) { synth.pause(); synth.resume(); } }, 10000);
  }
  function pause() { playing = false; token++; if (synth) synth.cancel(); clearInterval(keep); setPlayUI(); wake(false); }
  async function open() {
    if (!synth) { opt.toast('이 브라우저는 음성 듣기를 지원하지 않습니다. 기기별 안내를 확인해 주세요'); openModal(); return; }
    await build(opt.getStart(false));
    if (!queue.length) { opt.toast('읽을 본문이 없습니다'); return; }
    bar.hidden = false; btn.setAttribute('aria-pressed', 'true'); document.body.classList.add('tts-open');
    $('#tts-rate').textContent = rate() + '×';
    if (!voices.length) loadVoices();
    play();
    if (!voices.length && !LS.get('jesam.tts.guided')) { LS.set('jesam.tts.guided', '1'); opt.toast('더 자연스러운 목소리는 ⚙ 목소리 설정에서 안내합니다'); }
  }
  function close() { pause(); clearMark(); lastBlock = null; queue = []; bar.hidden = true; btn.setAttribute('aria-pressed', 'false'); document.body.classList.remove('tts-open'); }

  btn.addEventListener('click', () => bar.hidden ? open() : close());
  $('#tts-play').addEventListener('click', () => playing ? pause() : play());
  $('#tts-prev').addEventListener('click', () => { const i = Math.max(0, qi - 1); if (playing) speak(i); else { qi = i; mark(queue[i]); } });
  $('#tts-next').addEventListener('click', () => { const i = Math.min(queue.length - 1, qi + 1); if (playing) speak(i); else { qi = i; mark(queue[i]); } });
  $('#tts-rate').addEventListener('click', () => {
    const i = RATES.indexOf(rate()); const v = RATES[(i + 1) % RATES.length]; opt.setRate(v);
    $('#tts-rate').textContent = v + '×'; if (playing) speak(qi);
  });
  $('#tts-close').addEventListener('click', close);
  $('#tts-set').addEventListener('click', openModal);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && playing) wake(true); });

  /* ---- 목소리 설정 창 ---- */
  function openModal() { renderModal(); modal.hidden = false; }
  function renderModal() {
    const d = device();
    $('#ttsm-dev').textContent = `지금 기기: ${d.label}`;
    const best = voices.length ? score(voices[0]) : 0;
    const tip = !synth ? '이 브라우저는 음성 듣기를 지원하지 않습니다. 아래 안내에 맞는 브라우저로 열어 주세요.'
      : !voices.length ? '이 기기에서 한국어 목소리를 찾지 못했습니다. 아래 기기별 안내대로 한국어 목소리를 설치해 주세요.'
      : best < 3 ? (d.os === 'windows' || d.os === 'mac' ? '더 자연스러운 목소리를 원하면 <b>Microsoft Edge</b> 브라우저로 여세요. (아래 안내)' : '더 자연스러운 목소리를 원하면 아래 안내대로 <b>향상된·프리미엄 목소리</b>를 내려받으세요.')
      : '';
    $('#ttsm-tip').innerHTML = tip; $('#ttsm-tip').hidden = !tip;
    $('#ttsm-rate').value = rate(); $('#ttsm-rate-v').textContent = rate() + '×';
    $('#ttsm-voices').innerHTML = voices.length ? voices.map((v, i) => { const [s, t] = stars(score(v)); return `<li class="${voice === v ? 'on' : ''}">
        <label><input type="radio" name="ttsv" value="${i}" ${voice === v ? 'checked' : ''}><span class="vn">${esc(niceName(v))}</span><span class="vs" title="${t}">${s}</span>${v.localService === false ? '<span class="vo">인터넷</span>' : ''}</label>
        <button type="button" class="ghost" data-try="${i}">미리 듣기</button></li>`; }).join('')
      : '<li class="empty">한국어 목소리가 없습니다.</li>';
    $('#ttsm-guide').innerHTML = GUIDE.map(g => `<details ${g.os.includes(d.os) ? 'open' : ''}><summary>${g.title}${g.os.includes(d.os) ? ' <span class="here">지금 기기</span>' : ''}</summary>${g.html}</details>`).join('');
  }
  modal.addEventListener('change', e => {
    if (e.target.name === 'ttsv') { voice = voices[+e.target.value]; LS.set('jesam.tts.voice', voice.voiceURI); $('#tts-voice').textContent = niceName(voice); renderModal(); if (playing) speak(qi); }
    if (e.target.id === 'ttsm-rate') { const v = +e.target.value; opt.setRate(v); $('#ttsm-rate-v').textContent = v + '×'; $('#tts-rate').textContent = v + '×'; if (playing) speak(qi); }
  });
  modal.addEventListener('input', e => { if (e.target.id === 'ttsm-rate') $('#ttsm-rate-v').textContent = e.target.value + '×'; });
  modal.addEventListener('click', e => {
    const t = e.target.closest('[data-try]');
    if (t) { const wasPlaying = playing; if (wasPlaying) pause(); synth.cancel(); const v = voices[+t.dataset.try]; const u = new SpeechSynthesisUtterance('예수님을 사랑함으로 좇아가는 삶, 제자의 삶에 오신 것을 환영합니다.'); u.voice = v; u.lang = v.lang; u.rate = rate(); synth.speak(u); return; }
    if (e.target.id === 'ttsm' || e.target.closest('#ttsm-close')) modal.hidden = true;
  });

  return {
    open, close, openModal,
    /* 본문이 다시 그려질 때(다른 과로 이동 등) — 폰에서 다음 단원으로 넘어가는 중이 아니면 멈춤 */
    rerendered() { if (!bar.hidden && !advancing) close(); else lastBlock = null; },
    active: () => !bar.hidden
  };
}
