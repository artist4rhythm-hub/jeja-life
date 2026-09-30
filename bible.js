/* 제자의 삶 — 성경 패널
 * 번역: 개역한글(1961·공개) · KJV(공개) · BSB(CC0) 앱 안에 포함
 *       새번역·개역개정·공동번역(대한성서공회) · NIV(BibleGateway)는 패널 안에서 해당 사이트를 엶
 * 원어·사전: STEPBible.org (CC BY 4.0) — 히브리어(WLC)·헬라어(NA28 기준) 단어별 음역·스트롱 번호·뜻
 * 한국어 뜻·요약: AI가 사전 원문을 요약한 참고용 */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BASE = 'bible/';

let books = null, byId = {}, alias = [];
const cacheT = {}, cacheO = {}, cacheLex = {};
const st = { bk: 'JHN', ch: 1, v1: 0, v2: 0, mode: 'k', ext: null, searchLines: null };
const MODES = [['k', '개역한글'], ['j', 'KJV'], ['b', 'BSB'], ['o', '원어'], ['c', '비교']];
const EXT = [
  ['SAENEW', '새번역', 'bsk'], ['GAE', '개역개정', 'bsk'], ['COGNEW', '공동번역', 'bsk'], ['NIV', 'NIV', 'bg']
];
const POS = { V: '동사', N: '명사', A: '형용사', ADV: '부사', PREP: '전치사', CONJ: '접속사', PRT: '불변화사', T: '관사', R: '대명사', P: '대명사', I: '감탄사', INJ: '감탄사', D: '부사' };

async function j(url) { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); }
export async function loadBooks() {
  if (books) return books;
  books = await j(BASE + 'books.json');
  books.forEach(b => { byId[b.id] = b; alias.push([b.ko, b.id], [b.ab, b.id]); });
  // 자주 쓰는 다른 표기
  [['시편', 'PSA'], ['요한복음', 'JHN'], ['요한1서', '1JN'], ['요한2서', '2JN'], ['요한3서', '3JN'], ['계시록', 'REV'], ['아가서', 'SNG'], ['애가', 'LAM'],
   ['사무엘상', '1SA'], ['사무엘하', '2SA'], ['열왕기상', '1KI'], ['열왕기하', '2KI'], ['역대상', '1CH'], ['역대하', '2CH'], ['빌레몬', 'PHM'], ['유다', 'JUD'], ['로마', 'ROM']]
    .forEach(a => alias.push(a));
  alias.sort((a, b) => b[0].length - a[0].length);
  return books;
}
const bookOf = name => { const n = name.replace(/\s/g, ''); const hit = alias.find(a => a[0] === n); return hit ? hit[1] : null; };

/* "엡1:3-5", "요 3:16", "고후5;17", "창1,2장", "엡5:31,32", "요한복음 3장 16절" → {bk, ch, v1, v2} */
export function parseRef(s) {
  if (!books) return null;
  const t = String(s).replace(/[\[\]()]/g, '').replace(/절/g, '').trim();
  const m = t.match(/^([1-3]?\s?[가-힣]+)\s*(\d+)\s*(?:[:;장]\s*(\d+))?(?:\s*[-~,]\s*(\d+))?/);
  if (!m) return null;
  const bk = bookOf(m[1]); if (!bk) return null;
  const ch = +m[2]; if (!byId[bk] || ch < 1 || ch > byId[bk].ch) return null;
  const v1 = m[3] ? +m[3] : 0; const v2 = m[4] && m[3] ? Math.max(+m[4], v1) : v1;
  return { bk, ch, v1, v2 };
}

/* 본문 HTML 속 성경 구절 표기를 눌러 볼 수 있는 링크로 (글자는 바꾸지 않음) */
const REF_RE = /((?:[1-3]\s?)?[가-힣]{1,7})\s?(\d{1,3})\s?[:;]\s?(\d{1,3})(?:\s?[-~]\s?\d{1,3})?(?:\s?,\s?\d{1,3})*(?:절)?/g;
export function linkRefs(html) {
  if (!books) return html;
  return html.replace(REF_RE, (all, bkName) => {
    let name = bkName, lead = '';
    // "말씀과 같이 딤후2:3" 처럼 앞말이 붙은 경우: 뒤쪽에서 책 이름을 찾음
    let id = bookOf(name);
    if (!id) { for (let i = 1; i < name.length - 1 && !id; i++) { const tail = name.slice(i); const b = bookOf(tail); if (b) { id = b; lead = name.slice(0, i); name = tail; } } }
    if (!id) return all;
    const rest = all.slice(bkName.length);
    const r = parseRef(name + rest); if (!r || !r.v1) return all;   // 실제 있는 장·절만
    return `${lead}<span class="vref" data-ref="${esc(name + rest)}">${name}${rest}</span>`;
  });
}

async function text(bk) { return cacheT[bk] || (cacheT[bk] = await j(`${BASE}t/${bk}.json`)); }
async function orig(bk) { return cacheO[bk] || (cacheO[bk] = await j(`${BASE}o/${bk}.json`)); }
async function lex(key) {
  const chunk = key[0] + Math.floor(+key.slice(1, 5) / 1000);
  const d = cacheLex[chunk] || (cacheLex[chunk] = await j(`${BASE}lex/${chunk}.json`).catch(() => ({})));
  return d[key] || d[key.slice(0, 5)] || null;
}

/* ---------------- 화면 ---------------- */
let root, bodyEl, titleEl, extEl, pickEl, lexEl;
export function initBible(el) {
  root = el;
  root.innerHTML = `
  <form class="bb-q" id="bb-form" autocomplete="off">
    <input id="bb-in" type="search" placeholder="엡 1:3-5 · 요3:16 · 사랑 · love · H157" aria-label="성경 찾기">
    <button type="submit" class="primary">찾기</button>
    <button type="button" class="ghost" id="bb-pick">책·장</button>
  </form>
  <div class="bb-vers" role="tablist">${MODES.map(([k, n]) => `<button type="button" data-m="${k}">${n}</button>`).join('')}
    <span class="bb-sep"></span>${EXT.map(([k, n]) => `<button type="button" class="ext" data-x="${k}">${n} ↗</button>`).join('')}</div>
  <div class="bb-head"><button type="button" class="icon-btn" id="bb-prev" aria-label="이전 장">‹</button><b id="bb-title"></b><button type="button" class="icon-btn" id="bb-next" aria-label="다음 장">›</button></div>
  <div class="bb-body" id="bb-body"></div>
  <div class="bb-ext" id="bb-ext" hidden>
    <div class="bb-ext-bar"><span id="bb-ext-name"></span><span class="grow"></span><a id="bb-ext-open" target="_blank" rel="noopener" class="ghost">새 창으로 열기 ↗</a><button type="button" class="ghost" id="bb-ext-close">닫기</button></div>
    <iframe id="bb-frame" title="외부 성경" referrerpolicy="no-referrer"></iframe>
    <p class="bb-ext-note">화면이 비어 있으면 해당 사이트가 앱 안에서 열리는 것을 막은 것입니다. [새 창으로 열기]를 눌러 주세요.</p>
  </div>
  <div class="bb-pick" id="bb-picker" hidden></div>
  <div class="bb-lex" id="bb-lex" hidden></div>
  <p class="bb-credit">개역한글(1961)·KJV 공개 · BSB CC0 · 원어·사전 <a href="https://github.com/STEPBible/STEPBible-Data" target="_blank" rel="noopener">STEPBible.org</a> CC BY 4.0 · 한국어 뜻풀이는 AI 요약(참고용)</p>`;
  bodyEl = $('#bb-body', root); titleEl = $('#bb-title', root); extEl = $('#bb-ext', root); pickEl = $('#bb-picker', root); lexEl = $('#bb-lex', root);

  $('#bb-form', root).addEventListener('submit', e => { e.preventDefault(); query($('#bb-in', root).value.trim()); });
  $('#bb-pick', root).addEventListener('click', () => showPicker());
  $('#bb-prev', root).addEventListener('click', () => step(-1));
  $('#bb-next', root).addEventListener('click', () => step(1));
  $('.bb-vers', root).addEventListener('click', e => {
    const m = e.target.closest('[data-m]'); if (m) { st.mode = m.dataset.m; st.ext = null; extEl.hidden = true; render(); }
    const x = e.target.closest('[data-x]'); if (x) openExt(x.dataset.x);
  });
  $('#bb-ext-close', root).addEventListener('click', () => { st.ext = null; extEl.hidden = true; markVers(); });
  bodyEl.addEventListener('click', e => {
    const w = e.target.closest('.wt'); if (w) { showLex(w.dataset.s, w); return; }
    const r = e.target.closest('[data-go]'); if (r) { const [bk, c, v] = r.dataset.go.split('.'); go(bk, +c, +v, +v); }
  });
  pickEl.addEventListener('click', e => {
    const b = e.target.closest('[data-b]'); if (b) { showPicker(b.dataset.b); return; }
    const c = e.target.closest('[data-c]'); if (c) { pickEl.hidden = true; go(c.dataset.bk, +c.dataset.c, 0, 0); }
    if (e.target.closest('.bb-pick-close')) pickEl.hidden = true;
  });
  lexEl.addEventListener('click', e => { if (e.target.closest('.bb-lex-close')) lexEl.hidden = true; const r = e.target.closest('[data-go]'); if (r) { lexEl.hidden = true; const [bk, c, v] = r.dataset.go.split('.'); go(bk, +c, +v, +v); } });
  markVers();
}

function markVers() {
  root.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', !st.ext && b.dataset.m === st.mode));
  root.querySelectorAll('[data-x]').forEach(b => b.classList.toggle('on', st.ext === b.dataset.x));
}

export async function openRef(ref) {
  await loadBooks();
  const r = typeof ref === 'string' ? parseRef(ref) : ref;
  if (!r) { $('#bb-in', root).value = String(ref); return query(String(ref)); }
  $('#bb-in', root).value = typeof ref === 'string' ? ref.replace(/[\[\]()]/g, '') : '';
  if (st.ext) { go(r.bk, r.ch, r.v1, r.v2).then(() => openExt(st.ext)); return; }
  return go(r.bk, r.ch, r.v1, r.v2);
}

async function go(bk, ch, v1, v2) {
  await loadBooks(); st.bk = bk; st.ch = ch; st.v1 = v1; st.v2 = v2 || v1;
  lexEl.hidden = true; pickEl.hidden = true;
  if (st.ext) openExt(st.ext); else await render();
}
function step(d) {
  const b = byId[st.bk]; let ch = st.ch + d, bk = st.bk;
  const i = books.indexOf(b);
  if (ch < 1) { if (i === 0) return; bk = books[i - 1].id; ch = books[i - 1].ch; }
  if (ch > b.ch) { if (i === books.length - 1) return; bk = books[i + 1].id; ch = 1; }
  go(bk, ch, 0, 0);
}

async function render() {
  await loadBooks(); markVers();
  const b = byId[st.bk];
  titleEl.textContent = `${b.ko} ${st.ch}장` + (st.v1 ? ` ${st.v1}${st.v2 > st.v1 ? '-' + st.v2 : ''}절` : '');
  bodyEl.innerHTML = '<p class="muted bb-loading">불러오는 중…</p>';
  try {
    const T = (await text(st.bk))[st.ch - 1] || [];
    const O = (st.mode === 'o' || st.mode === 'c') ? ((await orig(st.bk))[st.ch - 1] || []) : null;
    const heb = !b.nt;
    const sel = v => st.v1 && v >= st.v1 && v <= st.v2;
    const rows = T.map((t, i) => {
      const v = i + 1, cls = `bv${sel(v) ? ' sel' : ''}`;
      if (st.mode === 'o') {
        const ws = (O[i] || []).map(w => `<button type="button" class="wt" data-s="${esc(w[2])}"><span class="w-o" lang="${heb ? 'he' : 'grc'}">${esc(w[0])}</span><span class="w-t">${esc(w[1])}</span><span class="w-g">${esc(w[3])}</span></button>`).join('');
        return `<div class="${cls}" data-v="${v}"><sup>${v}</sup><div class="ow" dir="${heb ? 'rtl' : 'ltr'}">${ws || '<span class="muted">원어 없음</span>'}</div><p class="bv-sub">${esc(t[0])}</p></div>`;
      }
      if (st.mode === 'c') {
        const o = (O[i] || []).map(w => w[0]).join(' ');
        return `<div class="${cls} cmp" data-v="${v}"><sup>${v}</sup><p><span class="lab">개역한글</span>${esc(t[0])}</p><p><span class="lab">KJV</span>${esc(t[1])}</p><p><span class="lab">BSB</span>${esc(t[2])}</p><p class="orig" dir="${heb ? 'rtl' : 'ltr'}" lang="${heb ? 'he' : 'grc'}"><span class="lab">원어</span>${esc(o)}</p></div>`;
      }
      const k = { k: 0, j: 1, b: 2 }[st.mode];
      return `<p class="${cls}" data-v="${v}"><sup>${v}</sup>${esc(t[k])}</p>`;
    });
    bodyEl.innerHTML = rows.join('') || '<p class="muted">본문이 없습니다.</p>';
    if (st.mode === 'o') bodyEl.insertAdjacentHTML('afterbegin', '<p class="bb-tip">단어를 누르면 원어 사전(원문 + 한국어 요약)이 열립니다.</p>');
    const first = bodyEl.querySelector('.sel'); if (first) first.scrollIntoView({ block: 'center' }); else bodyEl.scrollTop = 0;
  } catch (e) { bodyEl.innerHTML = `<p class="muted">성경 본문을 불러오지 못했습니다. (${esc(e.message)})</p>`; }
}

function openExt(code) {
  st.ext = code; markVers();
  const b = byId[st.bk]; const [, name, site] = EXT.find(x => x[0] === code);
  let url;
  if (site === 'bsk') url = `https://www.bskorea.or.kr/bible/korbibReadpage.php?version=${code}&book=${b.bsk}&chap=${st.ch}&sec=${st.v1 || 1}`;
  else url = `https://www.biblegateway.com/passage/?search=${encodeURIComponent(`${b.en} ${st.ch}${st.v1 ? ':' + st.v1 + (st.v2 > st.v1 ? '-' + st.v2 : '') : ''}`)}&version=NIV`;
  $('#bb-ext-name', root).textContent = `${name} · ${b.ko} ${st.ch}장` + (site === 'bsk' ? ' · 대한성서공회' : ' · BibleGateway');
  $('#bb-ext-open', root).href = url;
  const f = $('#bb-frame', root); if (f.src !== url) f.src = url;
  extEl.hidden = false;
}

function showPicker(bk) {
  pickEl.hidden = false;
  if (!bk) {
    const grp = nt => books.filter(b => b.nt === nt).map(b => `<button type="button" data-b="${b.id}" class="${b.id === st.bk ? 'on' : ''}">${b.ab}<small>${b.ko}</small></button>`).join('');
    pickEl.innerHTML = `<div class="bb-pick-h"><b>책 고르기</b><button type="button" class="icon-btn bb-pick-close" aria-label="닫기">✕</button></div><p class="bb-pick-t">구약</p><div class="bb-grid">${grp(false)}</div><p class="bb-pick-t">신약</p><div class="bb-grid">${grp(true)}</div>`;
  } else {
    const b = byId[bk];
    pickEl.innerHTML = `<div class="bb-pick-h"><button type="button" class="ghost" data-b="">‹ 책</button><b>${b.ko}</b><button type="button" class="icon-btn bb-pick-close" aria-label="닫기">✕</button></div><div class="bb-grid ch">${Array.from({ length: b.ch }, (_, i) => `<button type="button" data-bk="${bk}" data-c="${i + 1}">${i + 1}</button>`).join('')}</div>`;
    pickEl.querySelector('[data-b=""]').addEventListener('click', e => { e.stopPropagation(); showPicker(); });
  }
}

const POSK = p => { const m = (p || '').split(':')[1] || ''; const head = m.split('-')[0]; if ((p || '').startsWith('N:')) return '고유명사'; return POS[head] || m; };
async function showLex(key, tile) {
  lexEl.hidden = false; lexEl.innerHTML = '<p class="muted">사전 불러오는 중…</p>';
  const e = key ? await lex(key) : null;
  const w = tile ? { o: tile.querySelector('.w-o').textContent, t: tile.querySelector('.w-t').textContent, g: tile.querySelector('.w-g').textContent } : null;
  if (!e) { lexEl.innerHTML = `<div class="bb-lex-h"><b>${esc(w ? w.o : key)}</b><button type="button" class="icon-btn bb-lex-close" aria-label="닫기">✕</button></div><p>${esc(w ? w.g : '')}</p><p class="muted">사전 항목이 없습니다 (${esc(key || '번호 없음')}).</p>`; return; }
  const heb = key[0] === 'H';
  // 이 책에서 같은 단어가 쓰인 곳
  let uses = '';
  try {
    const O = await orig(st.bk); const hits = [];
    O.forEach((vs, ci) => vs.forEach((ws, vi) => { if (ws.some(x => x[2] === key)) hits.push([ci + 1, vi + 1]); }));
    if (hits.length) uses = `<p class="bb-lex-sec">${byId[st.bk].ko}에서 ${hits.length}번 쓰임</p><div class="bb-uses">${hits.slice(0, 60).map(([c, v]) => `<button type="button" data-go="${st.bk}.${c}.${v}">${c}:${v}</button>`).join('')}${hits.length > 60 ? '<span class="muted">…</span>' : ''}</div>`;
  } catch (_) {}
  const def = esc(e.d).replace(/&lt;(\/?)(b|i)&gt;/g, '<$1$2>').replace(/\n/g, '<br>');
  lexEl.innerHTML = `
    <div class="bb-lex-h"><span class="bb-lemma" lang="${heb ? 'he' : 'grc'}">${esc(e.l)}</span><button type="button" class="icon-btn bb-lex-close" aria-label="닫기">✕</button></div>
    <p class="bb-lex-meta">${esc(e.t)} · ${esc(POSK(e.p))} · <b>${esc(key)}</b>${w ? ` · 이 구절에서: “${esc(w.g)}”` : ''}</p>
    ${e.kg ? `<p class="bb-ko"><b>뜻</b> ${esc(e.kg)}</p>` : ''}
    ${e.ks ? `<p class="bb-ko-sum">${esc(e.ks)}</p>` : ''}
    <p class="bb-en"><b>English</b> ${esc(e.g)}</p>
    <details class="bb-def"><summary>사전 원문 보기</summary><div>${def}</div></details>
    ${uses}`;
}

async function query(q) {
  if (!q) return; await loadBooks();
  const r = parseRef(q); if (r) { st.ext = null; extEl.hidden = true; return go(r.bk, r.ch, r.v1, r.v2); }
  if (/^[HGhg]\s?\d{1,4}[A-Za-z]?$/.test(q)) { const n = q.replace(/\s/g, ''); const key = n[0].toUpperCase() + n.slice(1).replace(/^\d+/, d => d.padStart(4, '0')); return showLex(key); }
  // 낱말 찾기 (개역한글·KJV·BSB)
  titleEl.textContent = `“${q}” 찾는 중…`; bodyEl.innerHTML = '<p class="muted bb-loading">성경 전체를 찾는 중… (처음 한 번은 몇 초 걸립니다)</p>';
  st.ext = null; extEl.hidden = true;
  if (!st.searchLines) { const t = await (await fetch(BASE + 'search.txt')).text(); st.searchLines = t.split('\n'); }
  const low = q.toLowerCase(); const out = [];
  for (const line of st.searchLines) { if (line.toLowerCase().includes(low)) { out.push(line); if (out.length >= 500) break; } }
  titleEl.textContent = `“${q}” ${out.length >= 500 ? '500건 이상' : out.length + '건'}`;
  const hl = s => esc(s).replace(new RegExp(esc(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
  bodyEl.innerHTML = out.map(l => {
    const [bk, c, v, k, kj, bs] = l.split('\t'); const hit = [k, kj, bs].find(x => x.toLowerCase().includes(low)) || k;
    return `<button type="button" class="bb-res" data-go="${bk}.${c}.${v}"><b>${byId[bk].ab} ${c}:${v}</b> ${hl(hit)}</button>`;
  }).join('') || '<p class="muted">찾는 말이 없습니다.</p>';
}
