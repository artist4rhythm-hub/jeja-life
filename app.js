/* 제자의 삶 디지털 교재 — 앱 (vanilla JS, ES module)
 * 교재 본문·원본 사진·내 표시·자료는 backend.js를 통해 Firestore에 저장됩니다.
 * (주소 끝에 ?local 을 붙이면 data/ 폴더와 이 기기 저장소로 시험 실행)
 */
import { createBackend } from './backend.js';
import { editImage } from './imgedit.js';
import { initBible, openRef as bibleOpen, linkRefs, loadBooks } from './bible.js';
import { initTTS, device, say, stopSay, VLANG, AR_C, arCountry, setArCountry, arHas, pickVoice, voiceLabel } from './tts.js';
let B = null;
(() => {
'use strict';

/* ---------------- 저장소 (화면용 메모리 + 백엔드 기록) ---------------- */
const Store = (() => {
  const mem = { marks: [], answers: {}, done: {}, atts: {}, prefs: {} };
  const fail = e => { console.error(e); toast('저장하지 못했습니다. 인터넷 연결을 확인해 주세요'); };
  const groupDoc = gid => {
    const segs = mem.marks.filter(m => m.gid === gid); if (!segs.length) return null; const f = segs[0];
    return { lid: f.lid, c: f.c, note: f.note || '', photos: f.photos || [], at: f.at, segs: segs.map(x => ({ block: x.block, s: x.s, e: x.e, quote: x.quote })) };
  };
  let prefT;
  return {
    async load() { const u = await B.loadUser(); Object.assign(mem, { marks: u.marks, answers: u.answers, done: u.done, prefs: u.prefs || {} }); },
    marks: () => mem.marks,
    addMarks(list) { mem.marks.push(...list); B.saveMark(list[0].gid, groupDoc(list[0].gid)).catch(fail); },
    removeGroup(gid) { const f = mem.marks.find(m => m.gid === gid); (f && f.photos || []).forEach(id => B.deletePhoto(id).catch(() => {})); mem.marks = mem.marks.filter(m => m.gid !== gid); B.deleteMark(gid).catch(fail); },
    setNote(gid, note, photos) { let first = true; mem.marks.forEach(m => { if (m.gid === gid) { m.note = first ? note : ''; if (first && photos) m.photos = photos; first = false; } }); return B.saveMark(gid, groupDoc(gid)).catch(fail); },
    answers: () => mem.answers,
    async setAnswer(id, t) {
      const v = t.trim() ? t : ''; if (v) mem.answers[id] = { t: v, at: Date.now() }; else delete mem.answers[id];
      try { await B.setAnswer(id, v); return true; } catch (e) { console.error(e); return false; }
    },
    done: () => mem.done,
    setDone(uid, v) { if (v) mem.done[uid] = Date.now(); else delete mem.done[uid]; B.setDone(uid, v).catch(fail); },
    atts: () => Object.values(mem.atts).flat(),
    hasAtts: lid => lid in mem.atts,
    setRemote(part) { Object.assign(mem, part); },
    setRemoteAtts(lid, list) { mem.atts[lid] = list; },
    async loadAtts(lid) { try { mem.atts[lid] = await B.listAtts(lid); } catch (e) { console.error(e); mem.atts[lid] = []; } },
    async addAtt(a) { await B.addAtt(a); (mem.atts[a.lid] = mem.atts[a.lid] || []).push(a); },
    async updateAtt(id, patch) {
      const a = this.atts().find(x => x.id === id); if (!a) return;
      await B.updateAtt(a, patch); Object.assign(a, patch);
    },
    async removeAtt(id) {
      const a = this.atts().find(x => x.id === id); if (!a) return;
      await B.removeAtt(a); mem.atts[a.lid] = mem.atts[a.lid].filter(x => x.id !== id);
    },
    pref: (k, d) => (k in mem.prefs ? mem.prefs[k] : d),
    setPref(k, v) { mem.prefs[k] = v; clearTimeout(prefT); prefT = setTimeout(() => B.setPrefs(mem.prefs).catch(() => {}), 1500); }
  };
})();

/* ---------------- 공통 ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = s => linkRefs(esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>'));
const plain = s => String(s || '').replace(/\*\*/g, '').replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1$2');
const uidGen = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const mq = matchMedia('(max-width:759px)');
const isMob = () => mq.matches;
// 쪽 이름: 제자의 삶 = "12", "i1" / 새 교재 = 책코드_쪽 ("cs_3", "ct_i2")
const pageLabel = p => { const v = String(p).replace(/^[a-z][a-z0-9]*_/, ''); return /^i\d/.test(v) ? `안내 ${v.slice(1)}쪽` : `${v}쪽`; };
const lessonNo = L => (L.no >= 1 && L.no <= 12) ? String(L.no) : '';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 1800); }

let tts = null;
const st = { library: [], indexes: {}, book: null, index: null, lessons: {}, lid: null, ui: 0, pg: null, scope: 'all', visibleUnit: null };

/* ---------------- 데이터 ---------------- */
/* ---------------- 서재 (여러 교재) ----------------
 * lessons/_library 에 교재 목록, 교재마다 목차 문서(제자의 삶 = _index, 새 교재 = _index_<책코드>).
 * 과 ID 앞글자로 어느 교재인지 압니다 (L = 제자의 삶, S = 창조주를 소개합니다, T = 교사 매뉴얼 …). */
const JEJA = { id: 'jeja', title: '제자의 삶', short: '제자의 삶', sub: '예수님을 사랑함으로 좇아가는 삶', tag: '훈련 시리즈 2', prefix: 'L', color: 'green', access: 'all', group: '제자 훈련', order: 1, indexDoc: '_index', series: 'jeja', edition: '2024년 8월판' };
const isStaff = () => st.me && (st.me.role === 'admin' || st.me.role === 'teacher');
const canSee = b => b && (b.access !== 'staff' || isStaff());
const bookById = id => st.library.find(b => b.id === id);
const bookOfLid = lid => st.library.find(b => lid && lid[0] === b.prefix) || null;
const posKey = id => id === 'jeja' ? 'pos' : 'pos_' + id;
const curBook = () => bookById(st.book) || JEJA;
/* 판(버전): 같은 교재(series)의 여러 판. 각 판은 서재 목록의 한 항목이고, 판마다 형광펜·메모가 따로 저장됨 */
const seriesOf = b => b.series || b.id;
const editionsOf = sr => st.library.filter(b => seriesOf(b) === sr && canSee(b)).sort((a, b) => String(b.edition || '').localeCompare(String(a.edition || ''), 'ko', { numeric: true }));
function chosenEdition(sr) {
  const eds = editionsOf(sr); if (!eds.length) return null;
  return eds.find(b => b.id === Store.pref('ed_' + sr, '')) || eds.find(b => b.seriesDefault) || eds[0];
}
const bookLabel = b => b ? (b.title + (b.edition ? ' · ' + b.edition : '')) : '';
async function loadLibrary() {
  let lib = await B.getLibrary(); lib = Array.isArray(lib) ? lib : [];
  if (!lib.some(b => b.id === 'jeja')) lib.unshift({ ...JEJA });
  lib = lib.map(b => b.id === 'jeja' ? { ...JEJA, ...b, series: b.series || 'jeja', edition: b.edition || JEJA.edition } : b);
  st.library = lib.sort((a, b) => (a.order || 99) - (b.order || 99));
  return st.library;
}
async function loadBookIndex(id) {
  if (st.indexes[id]) return st.indexes[id];
  const b = bookById(id); if (!b || !canSee(b)) return null;
  const ix = await B.getIndex(b.indexDoc || (id === 'jeja' ? '_index' : '_index_' + id));
  if (ix) st.indexes[id] = ix; return ix;
}
async function loadIndex() { st.indexes = {}; await loadLibrary(); st.index = await loadBookIndex(st.book || 'jeja'); return st.index; }
async function loadLesson(lid) {
  if (st.lessons[lid]) return st.lessons[lid];
  const L = await B.getLesson(lid);
  L.blockUnit = {}; L.blockMap = {};
  L.units.forEach((u, i) => u.blocks.forEach(b => { L.blockUnit[b.id] = i; L.blockMap[b.id] = b; }));
  L.cover = L.units[0] && L.units[0].title === '표지' ? L.units[0] : null;
  L.body = L.units.filter(u => u !== L.cover);
  st.lessons[lid] = L; return L;
}
const cur = () => st.lessons[st.lid];

/* ---------------- 목차 ---------------- */
function renderToc() {
  const L = cur(); const done = Store.done();
  $('#toc').innerHTML = st.index.lessons.map(x => {
    const on = x.id === st.lid;
    const units = on && L ? `<ol class="units">${L.body.map((u, i) =>
      `<li><button type="button" data-unit="${i}" class="${(isMob() ? i === st.ui : u.id === st.visibleUnit) ? 'on' : ''} ${done[u.id] ? 'done' : ''}" title="${esc(plain(u.title))}">${esc(plain(u.title).length > 38 ? plain(u.title).slice(0, 36) + '…' : plain(u.title))}</button></li>`).join('')}</ol>` : '';
    return `<li class="${x.ready ? '' : 'off'} ${on ? 'cur' : ''}"><button type="button" data-lesson="${x.id}" ${x.ready ? '' : 'aria-disabled="true"'}>
      <span class="no">${lessonNo(x)}</span><span>${esc(x.title)}</span>
      <span class="pg">${x.ready ? (/^(?:[a-z][a-z0-9]*_)?i/.test(x.pageFrom) ? '' : pageLabel(x.pageFrom)) : '준비 중'}</span></button>${units}</li>`;
  }).join('');
}
$('#toc').addEventListener('click', e => {
  const lb = e.target.closest('[data-lesson]'), ub = e.target.closest('[data-unit]');
  if (ub) { goUnit(+ub.dataset.unit); closeSheets(); return; }
  if (lb) {
    const x = st.index.lessons.find(l => l.id === lb.dataset.lesson);
    if (!x.ready) { toast('아직 텍스트화 전인 과입니다'); return; }
    openLesson(x.id, 0); closeSheets();
  }
});

/* ---------------- 본문 렌더 ---------------- */
function blockHTML(b, prev) {
  const pg = (!prev || prev.page !== b.page) ? `<button type="button" class="pgmark" data-pg="${b.page}" title="원본 ${pageLabel(b.page)} 보기">${pageLabel(b.page)}</button>` : '';
  const A = `data-id="${b.id}" data-page="${b.page}"`;
  const tx = t => `<span class="tx">${inline(t)}</span>`;
  switch (b.t) {
    case 'h1': return `<h1 class="blk day" ${A}>${pg}${tx(b.text)}</h1>`;
    case 'h2': {
      let t = b.text, pre = '';
      const m = t.match(/^(\d+)\s+(.*)$/); const c = t.match(/^([✓✝†])\s*(.*)$/);
      if (m) { pre = `<span class="sq">${m[1]}</span>`; t = m[2]; } else if (c) { pre = `<span class="ck">${c[1]}</span>`; t = c[2]; }
      return `<h2 class="blk" ${A}>${pg}${pre}${tx(t)}</h2>`;
    }
    case 'h3': return `<h3 class="blk" ${A}>${pg}${tx(b.text)}</h3>`;
    case 'h4': return `<h4 class="blk" ${A}>${pg}${tx(b.text)}</h4>`;
    case 'h5': return `<h5 class="blk" ${A}>${pg}${tx(b.text)}</h5>`;
    case 'lead': return `<p class="blk lead" ${A}>${pg}${tx(b.text)}</p>`;
    case 'li': return `<p class="blk li" ${A}>${pg}${tx(b.text)}</p>`;
    case 'verse': return `<p class="blk verse" ${A}>${pg}${b.ref ? `<span class="ref vref" data-ref="${esc(b.ref)}" title="성경에서 보기">[${esc(b.ref)}]</span>` : ''}${tx(b.text)}</p>`;
    case 'indent': return `<p class="blk indent" ${A}>${pg}${tx(b.text)}</p>`;
    case 'cite': return `<p class="blk cite" ${A}>${pg}${tx('— ' + b.text)}</p>`;
    case 'right': return `<p class="blk right" ${A}>${pg}${tx(b.text)}</p>`;
    case 'q': {
      const a = Store.answers()[b.id];
      return `<p class="blk q" ${A}>${pg}${tx(b.text)}</p><textarea class="ans" data-for="${b.id}" rows="3" aria-label="답 쓰기" placeholder="여기에 답을 적어보세요">${a ? esc(a.t) : ''}</textarea>`;
    }
    case 'lines': return prev && prev.t === 'q' ? '' : `<textarea class="ans" data-for="${b.id}" rows="${b.n}" aria-label="답 쓰기">${esc((Store.answers()[b.id] || {}).t || '')}</textarea>`;
    case 'table': {
      const rows = b.rows.map(r => (!r[0] && !r[r.length - 1]) ? `<tr class="band"><td colspan="${r.length}">${esc(r.find(Boolean) || '')}</td></tr>`
        : `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
      return `<div class="blk tbl" ${A}>${pg}<table><thead><tr>${b.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    case 'fig': return `<div class="blk fig" ${A}>${pg}그림 · ${esc(b.text)} — <button type="button" class="pgmark-inline" data-pg="${b.page}">원본에서 보기</button></div>`;
    default: return `<p class="blk" ${A}>${pg}${tx(b.text)}</p>`;
  }
}
function unitHTML(u, i) {
  let prev = null; const html = u.blocks.map(b => { const h = blockHTML(b, prev); prev = b; return h; }).join('');
  return `<section class="unit" id="${u.id}" data-ui="${i}"><div class="card">${html}${extraHTML(u)}</div></section>`;
}
function heroHTML(L) {
  if (!L.cover) return '';
  const epi = L.cover.blocks.find(b => b.t === 'indent'), cite = L.cover.blocks.find(b => b.t === 'cite');
  const h1 = L.cover.blocks.find(b => b.t === 'h1');
  const ps = L.cover.blocks.filter(b => b.t === 'p'); const sub = ps.find(b => !epi || L.cover.blocks.indexOf(b) < L.cover.blocks.indexOf(epi)); const note = ps.find(b => b !== sub);
  const no = lessonNo(L);
  const title = no ? L.title : plain(h1 ? h1.text : L.title);
  return `<header class="hero" data-page="${L.cover.blocks[0].page}">${no ? `<div class="no" aria-hidden="true">${no}</div>` : `<div class="muted" style="font-size:13px">${esc(L.title)}</div>`}
    <h1 data-trid="${h1 ? h1.id : ''}">${esc(title)}</h1>${sub ? `<p class="hero-sub" data-trid="${sub.id}">${inline(sub.text)}</p>` : ''}${epi ? `<p class="epi" data-trid="${epi.id}">${inline(epi.text)}</p>` : ''}${cite ? `<p class="epi-cite" data-trid="${cite.id}">${esc(cite.text)}</p>` : ''}${note ? `<p class="hero-note" data-trid="${note.id}">${inline(note.text)}</p>` : ''}</header>`;
}
function extraHTML(u) {
  const list = Store.atts().filter(a => a.uid === u.id);
  return `<div class="unit-extra ${list.length ? '' : 'empty'}" data-uid="${u.id}"><div class="ue-h">추가 자료 ${list.length ? list.length : ''}<button type="button" class="add" data-add="${u.id}">+ 자료 추가</button></div>${list.map(attHTML).join('')}</div>`;
}
/* 자료 공개 범위: private = 올린 사람만 / teachers = 강사들 공개 / all = 전체 공개(훈련생 포함, 관리자만 선택) */
const VIS = { private: ['🔒', '나만 보기'], teachers: ['👥', '강사 공개'], all: ['🌐', '전체 공개'] };
const myUid = () => st.me && st.me.uid;
const isAdmin = () => st.me && st.me.role === 'admin';
const canEditAtt = a => isAdmin() || (a.author && a.author === myUid());
function visHTML(a) {
  const v = VIS[a.vis] ? a.vis : 'all';
  const who = a.author && a.author !== myUid() && a.authorName ? `<span class="att-by">${esc(a.authorName)}</span>` : '';
  if (!canEditAtt(a)) return `<span class="vis v-${v}" title="${VIS[v][1]}">${VIS[v][0]} ${VIS[v][1]}</span>${who}`;
  const opts = Object.entries(VIS).filter(([k]) => k !== 'all' || isAdmin() || v === 'all')
    .map(([k, [ic, t]]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${ic} ${t}</option>`).join('');
  return `<select class="vis-sel v-${v}" data-vis-att="${a.id}" aria-label="공개 범위">${opts}</select>${who}`;
}
function attHTML(a) {
  const del = canEditAtt(a) ? `<button type="button" class="del" data-del-att="${a.id}">삭제</button>` : '';
  const meta = `<div class="att-meta">${visHTML(a)}${del}</div>`;
  if (a.kind === 'link') return `<div class="supp"><div class="st">🔗 ${esc(a.title)}</div>${meta}<p><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url)}</a></p></div>`;
  if (a.kind === 'image') return `<div class="supp"><div class="st">🖼 ${esc(a.title)}</div>${meta}<img src="${esc(a.img || '')}" alt="${esc(a.title)}"></div>`;
  return `<div class="supp"><div class="st">📝 ${esc(a.title)}</div>${meta}<p>${esc(a.text || '')}</p></div>`;
}
async function changeVis(sel) {
  const id = sel.dataset.visAtt, v = sel.value;
  try { await Store.updateAtt(id, { vis: v }); refreshAtts(); toast(`공개 범위를 ${VIS[v][0]} ${VIS[v][1]}로 바꿨습니다`); }
  catch (e) { toast('바꾸지 못했습니다: ' + (e.code || e.message)); refreshAtts(); }
}
function hydrateImages() {}

function renderReader() {
  const L = cur(); const r = $('#reader');
  let html;
  if (isMob()) {
    const u = L.body[st.ui]; const done = Store.done();
    const chips = `<nav class="chips" aria-label="단원">${L.body.map((x, i) => `<button type="button" data-unit="${i}" class="${i === st.ui ? 'on' : ''} ${done[x.id] ? 'done' : ''}">${esc(short(x.title))}</button>`).join('')}</nav>`;
    const pct = Math.round((st.ui + 1) / L.body.length * 100);
    const p = L.body[st.ui - 1], n = L.body[st.ui + 1];
    const pager = `<div class="pager"><button type="button" data-go="${st.ui - 1}" ${p ? '' : 'disabled'}><small>이전</small><span>${p ? esc(p.title) : ''}</span></button>
      <button type="button" class="next" data-go="${st.ui + 1}" data-next="1"><small>${n ? '다 읽었어요 · 다음' : '다 읽었어요'}</small><span>${n ? esc(n.title) : '이 과 마치기 ✓'}</span></button></div>`;
    html = `<div class="page-wrap bk">${chips}<div class="prog"><i style="width:${pct}%"></i></div>${st.ui === 0 ? heroHTML(L) : ''}${unitHTML(u, st.ui)}${pager}</div>`;
  } else {
    html = `<div class="page-wrap bk">${heroHTML(L)}${L.body.map(unitHTML).join('')}</div>`;
  }
  r.innerHTML = html;
  if (tts) tts.rerendered();
  $('#top-lesson').textContent = (lessonNo(L) ? L.no + '과 ' : '') + L.title;
  $('#top-book').textContent = curBook().short || curBook().title;
  applyMarks(); hydrateImages(r); observeBlocks(); applyTr();
  const chip = $('.chips .on', r); if (chip) chip.scrollIntoView({ inline: 'center', block: 'nearest' });
}
const short = t => { const s = plain(t).replace(/[.?!]$/, ''); return s.length > 13 ? s.slice(0, 12) + '…' : s; };

async function openLesson(lid, ui = 0, blockId = null, q = null) {
  const bk = bookOfLid(lid); if (bk && bk.id !== st.book) return openBook(bk.id, lid, ui, blockId, q);
  const L = await loadLesson(lid);
  if (!Store.hasAtts(lid)) await Store.loadAtts(lid);
  watchLessonAtts(lid);
  const changed = st.lid !== lid; st.lid = lid;
  if (blockId) ui = Math.max(0, L.body.indexOf(L.units[L.blockUnit[blockId]]));
  st.ui = Math.min(Math.max(ui, 0), L.body.length - 1);
  renderReader(); renderToc(); renderNotes(); renderFiles();
  if (changed || !st.pg) showPage(L.pages[0], true);
  Store.setPref(posKey(st.book), { lid, ui: st.ui });
  history.replaceState(null, '', '#' + L.body[st.ui].id);
  if (blockId) jumpTo(blockId, q);
  else if (isMob()) window.scrollTo(0, 0);
  else if (ui > 0) $('#' + L.body[st.ui].id).scrollIntoView({ block: 'start' });
  else $('#reader').scrollTop = 0;
}
function goUnit(i) {
  const L = cur(); if (!L) return;
  if (isMob()) { st.ui = Math.min(Math.max(i, 0), L.body.length - 1); renderReader(); renderToc(); window.scrollTo(0, 0); Store.setPref(posKey(st.book), { lid: st.lid, ui: st.ui }); history.replaceState(null, '', '#' + L.body[st.ui].id); }
  else { const el = $('#' + L.body[i].id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
function jumpTo(blockId, q) {
  const el = $(`#reader [data-id="${blockId}"]`); if (!el) return;
  if (q) { const tx = $('.tx', el); if (tx) wrapFind(tx, q); }
  el.scrollIntoView({ block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
/* 한국어 본문(.tx) 글자 노드만 — '문장마다' 번역(.se) 글자는 빼고 셈 */
function koNodes(tx) {
  const w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement && n.parentElement.closest('.se') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const a = []; while (w.nextNode()) a.push(w.currentNode); return a;
}
function koText(tx) { return koNodes(tx).map(n => n.data).join(''); }
function wrapFind(tx, q) {
  const nodes = koNodes(tx);
  nodes.forEach(n => { let k; while ((k = n.textContent.indexOf(q)) >= 0) { const mid = n.splitText(k); const rest = mid.splitText(q.length); const m = document.createElement('mark'); m.className = 'find'; mid.parentNode.insertBefore(m, mid); m.appendChild(mid); n = rest; } });
}

$('#reader').addEventListener('click', e => {
  const t = e.target;
  const vr = t.closest('.vref'); if (vr) { e.preventDefault(); openBible(vr.dataset.ref); return; }
  const u = t.closest('.chips [data-unit]'); if (u) { goUnit(+u.dataset.unit); return; }
  const g = t.closest('[data-go]');
  if (g) { const L = cur(); if (g.dataset.next) Store.setDone(L.body[st.ui].id, true);
    const to = +g.dataset.go; if (to >= L.body.length) { toast('이 과를 모두 읽었습니다'); renderReader(); renderToc(); return; } goUnit(to); return; }
  const pg = t.closest('[data-pg]'); if (pg) { openOrig(pg.dataset.pg); return; }
  const add = t.closest('[data-add]'); if (add) { openAttModal(add.dataset.add); return; }
  const del = t.closest('[data-del-att]'); if (del) { Store.removeAtt(del.dataset.delAtt).then(() => { refreshAtts(); toast('자료를 삭제했습니다'); }, e => toast('삭제하지 못했습니다: ' + e.message)); return; }
  const img = t.closest('.supp img'); if (img && img.src) { const lb = $('#lightbox'); $('img', lb).src = img.src; lb.hidden = false; }
});

/* 답 쓰기 자동 저장 */
let ansT = {};
$('#reader').addEventListener('input', e => {
  const ta = e.target.closest('textarea.ans'); if (!ta) return;
  clearTimeout(ansT[ta.dataset.for]);
  ansT[ta.dataset.for] = setTimeout(async () => {
    const ok = await Store.setAnswer(ta.dataset.for, ta.value);
    let s = ta.nextElementSibling; if (!s || !s.classList.contains('saved')) { s = document.createElement('div'); s.className = 'saved'; ta.after(s); }
    s.textContent = ok ? '저장됨' : '저장하지 못했습니다 (인터넷 확인)'; renderNotes();
  }, 500);
});

/* ---------------- 형광펜 ---------------- */
const bar = $('#hlbar');
let selSegs = null, editGid = null, lastPointer = 'mouse';

function offsetIn(tx, node, off) { const r = document.createRange(); r.selectNodeContents(tx); try { r.setEnd(node, off); } catch (e) { return 0; } return r.toString().length; }
/* 한국어 본문 글자 위치: '문장마다' 번역(.se)이 본문 사이에 끼어 있어도 한국어 글자만 셈 */
function offsetKo(tx, node, off) {
  const r = document.createRange(); r.selectNodeContents(tx); try { r.setEnd(node, off); } catch (e) { return 0; }
  let acc = 0;
  for (const n of koNodes(tx)) { if (n === node) return acc + off; if (r.isPointInRange(n, n.length)) acc += n.length; else break; }
  return acc;
}
/* 번역 글자 고르기: 언어별·문장별로 나눠 저장 { block, tl:언어, k:문장 번호, s, e } */
const trUnits = l => $$(`#reader .se.tl-${l}, #reader .trb .tl-${l} .ts`);
function trSegments(R, startEl) {
  const l = (startEl.className.match(/tl-(\w+)/) || [])[1]; if (!l) return null;
  const segs = [];
  trUnits(l).forEach(c => {
    if (!R.intersectsNode(c)) return;
    const t = c.textContent;
    const s = c.contains(R.startContainer) ? offsetIn(c, R.startContainer, R.startOffset) : 0;
    const e = c.contains(R.endContainer) ? offsetIn(c, R.endContainer, R.endOffset) : t.length;
    if (e > s && t.slice(s, e).trim()) segs.push({ block: c.dataset.b, tl: l, k: +c.dataset.k, s, e, quote: t.slice(s, e) });
  });
  return segs.length ? { segs, rect: R.getBoundingClientRect() } : null;
}
function segmentsFromSelection() {
  const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return null;
  const R = sel.getRangeAt(0); const reader = $('#reader');
  if (!reader.contains(R.commonAncestorContainer)) return null;
  const sn = R.startContainer.nodeType === 1 ? R.startContainer : R.startContainer.parentElement;
  const trStart = sn && sn.closest('.se, .trb .tl');
  if (trStart) return trSegments(R, trStart);          // 번역에서 시작한 선택 → 번역에 칠하기
  const segs = [];
  $$('.tx', reader).forEach(tx => {
    if (!R.intersectsNode(tx)) return;
    const text = koText(tx), len = text.length;
    const s = tx.contains(R.startContainer) ? offsetKo(tx, R.startContainer, R.startOffset) : 0;
    const e = tx.contains(R.endContainer) ? offsetKo(tx, R.endContainer, R.endOffset) : len;
    if (e > s && text.slice(s, e).trim()) segs.push({ block: tx.closest('[data-id]').dataset.id, s, e, quote: text.slice(s, e) });
  });
  return segs.length ? { segs, rect: R.getBoundingClientRect() } : null;
}
function showBar(rect, mode) {
  $('.hl-main', bar).hidden = mode !== 'main'; $('.hl-memo', bar).hidden = mode !== 'memo'; $('.hl-edit', bar).hidden = mode !== 'edit';
  bar.hidden = false;
  const bw = bar.offsetWidth, bh = bar.offsetHeight, vw = document.documentElement.clientWidth;
  const x = Math.min(Math.max(8, rect.left + rect.width / 2 - bw / 2), vw - bw - 8) + scrollX;
  const below = lastPointer !== 'mouse' || rect.top < 110;
  const y = (below ? rect.bottom + 14 : rect.top - bh - 10) + scrollY;
  bar.style.left = x + 'px'; bar.style.top = y + 'px';
}
function hideBar() { bar.hidden = true; selSegs = null; editGid = null; }
function checkSelection() {
  const r = segmentsFromSelection();
  if (!r) { if (!bar.contains(document.activeElement)) hideBar(); return; }
  selSegs = r.segs; editGid = null; showBar(r.rect, 'main');
}
document.addEventListener('pointerdown', e => { lastPointer = e.pointerType || 'mouse'; if (!bar.contains(e.target) && !e.target.closest('mark.hl')) bar.hidden = true; });
document.addEventListener('mouseup', e => { if (lastPointer === 'mouse' && !bar.contains(e.target) && !(e.detail >= 2 && e.target.closest('mark.hl'))) setTimeout(checkSelection, 10); });
let selT; document.addEventListener('selectionchange', () => { if (lastPointer === 'mouse') return; clearTimeout(selT); selT = setTimeout(checkSelection, 450); });
$('#reader').addEventListener('scroll', () => { if (!bar.hidden && !bar.contains(document.activeElement)) bar.hidden = true; }, { passive: true });

/* ---------------- 펜으로 바로 긋기 (Apple Pencil·S펜) ----------------
 * 펜으로 글자 위를 그으면 고른 색으로 바로 칠해집니다. 손가락은 평소처럼 화면을 넘깁니다.
 * '손가락' 버튼을 켜면 손가락으로도 칠할 수 있습니다(그동안은 화면 넘기기가 멈춤). */
const IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let penColor = 'y', fingerDraw = false, drawing = null;
function caretAt(x, y) {
  if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(x, y); return r && { node: r.startContainer, off: r.startOffset }; }
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p && { node: p.offsetNode, off: p.offset }; }
  return null;
}
const inText = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return el && el.closest('#reader .tx, #reader .trb .ts'); };
function drawStart(x, y) { const c = caretAt(x, y); if (!c || !inText(c.node)) return false; drawing = { a: c, moved: false }; bar.hidden = true; return true; }
function drawMove(x, y) {
  if (!drawing) return; const c = caretAt(x, y); if (!c || !$('#reader').contains(c.node)) return;
  const r = document.createRange();
  try { r.setStart(drawing.a.node, drawing.a.off); r.setEnd(c.node, c.off); if (r.collapsed) { r.setStart(c.node, c.off); r.setEnd(drawing.a.node, drawing.a.off); } } catch (e) { return; }
  drawing.moved = !r.collapsed; const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
}
function drawEnd() {
  if (!drawing) return; const d = drawing; drawing = null; if (!d.moved) return;
  const r = segmentsFromSelection(); if (!r) { getSelection().removeAllRanges(); return; }
  selSegs = r.segs; addMark(penColor);
}
const skipTarget = t => t.closest('textarea, input, button, a, mark.hl, .unit-extra, .vref');
const reader = $('#reader');
if (IOS) {
  reader.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || skipTarget(e.target)) return; const t = e.touches[0];
    if (t.touchType !== 'stylus' && !fingerDraw) return;
    if (drawStart(t.clientX, t.clientY)) e.preventDefault();
  }, { passive: false });
  reader.addEventListener('touchmove', e => { if (!drawing) return; e.preventDefault(); const t = e.touches[0]; drawMove(t.clientX, t.clientY); }, { passive: false });
  reader.addEventListener('touchend', drawEnd); reader.addEventListener('touchcancel', () => { drawing = null; });
} else {
  const want = e => e.pointerType === 'pen' || (e.pointerType === 'touch' && fingerDraw);
  reader.addEventListener('pointerover', e => { if (e.pointerType === 'pen') reader.style.touchAction = 'none'; });
  reader.addEventListener('pointerleave', e => { if (e.pointerType === 'pen' && !fingerDraw) reader.style.touchAction = ''; });
  reader.addEventListener('pointerdown', e => { if (!want(e) || skipTarget(e.target)) return; if (drawStart(e.clientX, e.clientY)) { e.preventDefault(); try { reader.setPointerCapture(e.pointerId); } catch (_) {} } });
  reader.addEventListener('pointermove', e => { if (drawing && want(e)) drawMove(e.clientX, e.clientY); });
  reader.addEventListener('pointerup', e => { if (drawing) drawEnd(); });
  reader.addEventListener('pointercancel', () => { drawing = null; });
}
function setPenColor(c) { penColor = c; $$('#pendock [data-pc]').forEach(b => b.classList.toggle('on', b.dataset.pc === c)); Store.setPref('pen', c); }
function setFinger(on) {
  fingerDraw = on; $('#pd-finger').setAttribute('aria-pressed', on); document.body.classList.toggle('finger-draw', on);
  if (!IOS) reader.style.touchAction = on ? 'none' : '';
  toast(on ? '손가락으로 칠하기 켜짐 · 화면을 넘기려면 끄세요' : '손가락으로 칠하기 꺼짐');
}
$('#pendock').addEventListener('click', e => { const b = e.target.closest('[data-pc]'); if (b) setPenColor(b.dataset.pc); if (e.target.closest('#pd-finger')) setFinger(!fingerDraw); });
if (matchMedia('(any-pointer: coarse)').matches || IOS) $('#pendock').hidden = false;
addEventListener('pointerdown', e => { if (e.pointerType === 'pen') $('#pendock').hidden = false; }, { passive: true });

function addMark(c, note) {
  if (!selSegs) return; const gid = uidGen('m'); const at = Date.now();
  Store.addMarks(selSegs.map((s, i) => ({ id: gid + '-' + i, gid, lid: st.lid, block: s.block, ...(s.tl ? { tl: s.tl, k: s.k } : {}), s: s.s, e: s.e, c, note: i === 0 ? (note || '') : '', quote: s.quote, at })));
  getSelection().removeAllRanges(); hideBar(); applyMarks(); renderNotes();
  if (note) toast('메모를 저장했습니다');
}
$$('[data-c]', bar).forEach(b => b.addEventListener('click', () => addMark(b.dataset.c)));
$('#hl-memo').addEventListener('click', () => { const r = bar.getBoundingClientRect(); $('#hl-memo-in').value = ''; showBar({ left: r.left, width: r.width, top: r.top + (lastPointer === 'mouse' ? r.height + 10 : -14), bottom: r.top - 14 }, 'memo'); $('#hl-memo-in').focus(); });
function saveMemo() {
  const v = $('#hl-memo-in').value.trim();
  if (editGid) { Store.setNote(editGid, v); hideBar(); applyMarks(); renderNotes(); toast(v ? '메모를 고쳤습니다' : '메모를 비웠습니다'); return; }
  if (!v) return; addMark('y', v);
}
$('#hl-memo-ok').addEventListener('click', saveMemo);
$('#hl-memo-in').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); saveMemo(); } if (e.key === 'Escape') hideBar(); });
/* ---------------- 칠한 곳 메모: 한 번 누르면 보기, 두 번 누르면 바로 쓰기 ---------------- */
const pop = $('#notepop');
let popGid = null, lastTap = { gid: null, t: 0 }, tapT = null;
const COLOR_NAME = { y: '노랑', g: '초록', p: '분홍', b: '파랑', u: '밑줄' };
function openNote(gid, rect, edit) {
  const segs = Store.marks().filter(m => m.gid === gid); if (!segs.length) return;
  popGid = gid; hideBar();
  const quote = segs.map(x => x.quote).join(' … '), note = segs[0].note || '';
  const q = $('.np-quote', pop); q.textContent = quote.length > 90 ? quote.slice(0, 90) + '…' : quote; q.className = 'np-quote c-' + segs[0].c; q.dir = 'auto';
  popPhotos = (segs[0].photos || []).map(id => ({ id, url: photoCache.get(id) || null })); removedPhotos = [];
  $('.np-text', pop).textContent = note || (popPhotos.length ? '' : '아직 메모가 없습니다. 두 번 누르거나 [메모 쓰기]를 누르세요.');
  $('.np-text', pop).classList.toggle('empty', !note);
  $('#np-in').value = note;
  setPopMode(edit); renderPopPhotos();
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight, vw = document.documentElement.clientWidth, vh = innerHeight;
  const x = Math.min(Math.max(10, rect.left + rect.width / 2 - w / 2), vw - w - 10);
  let y = rect.bottom + 10; if (y + h > vh - 10 && rect.top - h - 10 > 10) y = rect.top - h - 10;
  pop.style.left = (x + scrollX) + 'px'; pop.style.top = (y + scrollY) + 'px';
  if (edit) setTimeout(() => { const t = $('#np-in'); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }, 30);
}
function setPopMode(edit) {
  pop.classList.toggle('editing', edit);
  $('#np-in').hidden = !edit; $('.np-text', pop).hidden = edit;
  $('#np-edit').hidden = edit; $('#np-save').hidden = !edit; $('#np-addphoto').hidden = !edit;
  if (typeof renderPopPhotos === 'function') renderPopPhotos();
  const has = !!(Store.marks().find(m => m.gid === popGid) || {}).note;
  $('#np-edit').textContent = has ? '메모 수정' : '메모 쓰기';
}
function closeNote() { pop.hidden = true; popGid = null; }
$('#np-edit').addEventListener('click', () => { setPopMode(true); $('#np-in').focus(); });
/* 메모 사진 */
let popPhotos = [], removedPhotos = [];
const photoCache = new Map();
async function photoUrl(id) {
  if (photoCache.has(id)) return photoCache.get(id);
  try { const u = await B.getPhoto(id); if (u) photoCache.set(id, u); return u; } catch (e) { return null; }
}
function renderPopPhotos() {
  const box = $('#np-photos'); const editing = pop.classList.contains('editing');
  box.hidden = !popPhotos.length;
  box.innerHTML = popPhotos.map((p, i) => `<figure class="np-ph" data-i="${i}">${p.url ? `<img src="${p.url}" alt="메모 사진 ${i + 1}">` : '<span class="np-ph-load">불러오는 중</span>'}${editing ? `<button type="button" class="np-ph-x" data-x="${i}" aria-label="사진 빼기">×</button>` : ''}</figure>`).join('');
  popPhotos.forEach((p, i) => { if (!p.url) photoUrl(p.id).then(u => { if (u && popPhotos[i] === p) { p.url = u; renderPopPhotos(); } }); });
}
$('#np-photos').addEventListener('click', e => {
  const x = e.target.closest('[data-x]'); if (x) { const [p] = popPhotos.splice(+x.dataset.x, 1); if (p && !p.isNew) removedPhotos.push(p.id); renderPopPhotos(); return; }
  const img = e.target.closest('.np-ph img'); if (img) { const lb = $('#lightbox'); $('img', lb).src = img.src; lb.hidden = false; }
});
$('#np-addphoto').addEventListener('click', () => { if (popPhotos.length >= 6) { toast('사진은 메모 하나에 6장까지 넣을 수 있습니다'); return; } $('#np-file').click(); });
$('#np-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const keep = popGid; const r = await editImage(f).catch(err => { toast('사진을 열 수 없습니다'); return null; });
  if (!r || popGid !== keep) return;
  popPhotos.push({ id: uidGen('ph'), url: r.dataUrl, isNew: true }); renderPopPhotos();
  toast(`사진 추가 · ${Math.round(r.bytes / 1024)}KB (${r.w}×${r.h})`);
});
$('#np-save').addEventListener('click', async () => {
  if (!popGid) return; const gid = popGid, v = $('#np-in').value.trim(); const btn = $('#np-save');
  btn.disabled = true; btn.textContent = popPhotos.some(p => p.isNew) ? '사진 저장 중…' : '저장 중…';
  try {
    for (const p of popPhotos.filter(p => p.isNew)) { await B.putPhoto(p.id, { gid, img: p.url, at: Date.now() }); photoCache.set(p.id, p.url); p.isNew = false; }
    removedPhotos.forEach(id => { B.deletePhoto(id).catch(() => {}); photoCache.delete(id); });
    Store.setNote(gid, v, popPhotos.map(p => p.id));
    closeNote(); applyMarks(); renderNotes(); toast(v || popPhotos.length ? '메모를 저장했습니다' : '메모를 비웠습니다');
  } catch (err) { toast('저장하지 못했습니다: ' + (err.code || err.message)); }
  finally { btn.disabled = false; btn.textContent = '저장'; }
});
$('#np-del').addEventListener('click', () => { if (!popGid) return; Store.removeGroup(popGid); closeNote(); applyMarks(); renderNotes(); toast('표시를 지웠습니다'); });
$('#np-close').addEventListener('click', closeNote);
$('#np-in').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#np-save').click(); } if (e.key === 'Escape') closeNote(); });
// 칠한 곳을 두 번 클릭할 때 단어가 선택되지 않게
$('#reader').addEventListener('mousedown', e => { if (e.detail >= 2 && e.target.closest('mark.hl')) e.preventDefault(); });
$('#reader').addEventListener('click', e => {
  if (e.target.closest('.vref')) return;
  const m = e.target.closest('mark.hl'); if (!m) return;
  const se0 = e.target.closest('.se'); if (se0 && !se0.contains(m)) return;   // 번역 문장(칠하지 않은 곳) 누르기 = 소리로 읽기
  const gid = m.dataset.gid, now = Date.now();
  if (lastTap.gid === gid && now - lastTap.t < 380) {           // 두 번 누름 → 바로 쓰기
    clearTimeout(tapT); lastTap = { gid: null, t: 0 }; getSelection().removeAllRanges();
    openNote(gid, m.getBoundingClientRect(), true); return;
  }
  if (!getSelection().isCollapsed) return;
  lastTap = { gid, t: now }; const rect = m.getBoundingClientRect();
  clearTimeout(tapT); tapT = setTimeout(() => openNote(gid, rect, false), 260);   // 한 번 누름 → 보기
});
document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('mark.hl, #imged, #lightbox, #toast')) closeNote(); });
$('#reader').addEventListener('scroll', () => { if (!pop.hidden && !pop.classList.contains('editing')) closeNote(); }, { passive: true });
addEventListener('scroll', () => { if (!pop.hidden && !pop.classList.contains('editing')) closeNote(); }, { passive: true });
$('#hl-del').addEventListener('click', () => { if (!editGid) return; Store.removeGroup(editGid); hideBar(); applyMarks(); renderNotes(); toast('표시를 지웠습니다'); });
$('#hl-note-edit').addEventListener('click', () => {
  const g = editGid; const first = Store.marks().find(m => m.gid === g); const r = bar.getBoundingClientRect();
  showBar({ left: r.left, width: r.width, top: r.top, bottom: r.bottom - r.height }, 'memo'); editGid = g;
  $('#hl-memo-in').value = first ? first.note : ''; $('#hl-memo-in').focus();
});

function allText(el) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const a = []; while (w.nextNode()) a.push(w.currentNode); return a; }
function trUnitEl(b, l, k) { const r = $('#reader'); return $(`.trb[data-for="${b}"] .tl-${l} .ts[data-k="${k}"]`, r) || $(`[data-id="${b}"] .se.tl-${l}[data-k="${k}"]`, r); }
function unwrapAll(root) { $$('mark.hl', root).forEach(m => { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); p.normalize(); }); }
function wrapOffsets(tx, s, e, cls, gid, title) {
  const nodes = tx.classList.contains('tx') ? koNodes(tx) : allText(tx);
  let pos = 0;
  nodes.forEach(n => {
    const a = pos, z = pos + n.length; pos = z;
    const from = Math.max(s, a), to = Math.min(e, z); if (from >= to) return;
    let t = n; if (from > a) t = t.splitText(from - a); if (to < z) t.splitText(to - from);
    const m = document.createElement('mark'); m.className = cls; m.dataset.gid = gid; if (title) m.title = title;
    t.parentNode.insertBefore(m, t); m.appendChild(t);
  });
}
function applyMarks() {
  const r = $('#reader'); unwrapAll(r);
  const notes = {}, photos = {}; Store.marks().forEach(m => { if (m.note) notes[m.gid] = m.note; if (m.photos && m.photos.length) photos[m.gid] = 1; });
  Store.marks().filter(m => m.lid === st.lid).forEach(m => {
    const tx = m.tl ? trUnitEl(m.block, m.tl, m.k) : $(`[data-id="${m.block}"] .tx`, r); if (!tx) return;   // 번역 표시는 그 번역이 화면에 있을 때만
    wrapOffsets(tx, m.s, m.e, `hl c-${m.c}${notes[m.gid] ? ' has-note' : ''}`, m.gid, notes[m.gid]);
  });
  new Set([...Object.keys(notes), ...Object.keys(photos)]).forEach(g => { const ms = $$(`mark.hl[data-gid="${g}"]`, r); if (ms.length) { const last = ms[ms.length - 1]; last.classList.add('note-end'); if (photos[g]) last.classList.add('has-photo'); } });
}

/* ---------------- 내 노트 ---------------- */
function renderNotes() {
  const groups = {}; Store.marks().forEach(m => { (groups[m.gid] = groups[m.gid] || []).push(m); });
  const items = Object.values(groups).map(g => ({ kind: 'mark', lid: g[0].lid, block: g[0].block, c: g[0].c, tl: g[0].tl, quote: g.map(x => x.quote).join(' … '), note: g[0].note, ph: (g[0].photos || []).length, at: g[0].at }));
  Object.entries(Store.answers()).forEach(([id, a]) => items.push({ kind: 'ans', lid: id.slice(0, 3), block: id, note: a.t, at: a.at }));
  const byL = {}; items.forEach(i => (byL[i.lid] = byL[i.lid] || []).push(i));
  const order = st.index.lessons.map(l => l.id).filter(id => byL[id]);
  const n = $('#notes');
  if (!order.length) { n.innerHTML = `<p class="empty">아직 표시한 곳이 없습니다.<br>본문 글자를 드래그해서 선택하면 형광펜·밑줄·메모 도구가 나타납니다.</p>`; return; }
  n.innerHTML = `<div class="nlist">${order.map(lid => {
    const L = st.index.lessons.find(l => l.id === lid);
    const list = byL[lid].sort((a, b) => a.block < b.block ? -1 : a.block > b.block ? 1 : a.at - b.at);
    return `<div class="ngroup">${lessonNo(L) ? L.no + '과 ' : ''}${esc(L.title)} · ${list.length}</div>` + list.map(i => i.kind === 'ans'
      ? `<button type="button" class="note" data-jump="${i.block}" data-lid="${lid}"><span class="kind">내 답</span><br>${esc(i.note.slice(0, 120))}</button>`
      : `<button type="button" class="note" data-jump="${i.block}" data-lid="${lid}">${i.tl && TRL[i.tl] ? `<span class="kind tlk tl-${i.tl}">${TRL[i.tl].tag}</span> ` : ''}<q class="c-${i.c}" dir="auto">${esc(i.quote.length > 70 ? i.quote.slice(0, 70) + '…' : i.quote)}</q>${i.note ? esc(i.note) : ''}${i.ph ? ` <span class="kind">📷 ${i.ph}</span>` : ''}</button>`).join('');
  }).join('')}</div>`;
}
$('#notes').addEventListener('click', e => { const b = e.target.closest('[data-jump]'); if (!b) return; closeSheets(); openLesson(b.dataset.lid, 0, b.dataset.jump); });

/* ---------------- 자료(첨부) ---------------- */
function renderFiles() {
  const L = cur(); if (!L) return; const f = $('#files');
  const list = Store.atts().filter(a => a.lid === L.id);
  const intro = st.me && st.me.role === 'member' ? (list.length ? '' : '<p class="empty">아직 공개된 자료가 없습니다.</p>')
    : `<p class="empty">과·단원마다 보충 설명, 링크(영상·찬양), 사진을 붙일 수 있습니다. 올린 자료는 기본으로 <b>🔒 나만 보기</b>이고, 자료마다 <b>👥 강사 공개</b>로 바꿀 수 있습니다.</p>`;
  f.innerHTML = intro +
    L.body.map(u => { const ul = list.filter(a => a.uid === u.id); return `<div class="ngroup">${esc(u.title)}</div>${ul.map(attHTML).join('')}<button type="button" class="note" data-add="${u.id}" style="color:var(--brand)">+ 이 단원에 자료 추가</button>`; }).join('');
  hydrateImages(f);
}
$('#files').addEventListener('change', e => { const s = e.target.closest('[data-vis-att]'); if (s) changeVis(s); });
$('#reader').addEventListener('change', e => { const s = e.target.closest('[data-vis-att]'); if (s) changeVis(s); });
$('#files').addEventListener('click', e => {
  const a = e.target.closest('[data-add]'); if (a) { openAttModal(a.dataset.add); return; }
  const d = e.target.closest('[data-del-att]'); if (d) { Store.removeAtt(d.dataset.delAtt).then(refreshAtts, er => toast('삭제하지 못했습니다: ' + er.message)); }
  const img = e.target.closest('.supp img'); if (img && img.src) { const lb = $('#lightbox'); $('img', lb).src = img.src; lb.hidden = false; }
});
function refreshAtts() { $$('#reader .unit-extra').forEach(x => { const u = cur().units.find(u => u.id === x.dataset.uid); const t = document.createElement('div'); t.innerHTML = extraHTML(u); x.replaceWith(t.firstElementChild); }); hydrateImages($('#reader')); renderFiles(); }

let attKind = 'note', attUid = null, attVis = 'private';
function setVis(v) { attVis = v; $$('#att-vis button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); $('#att-vis-help').textContent = { private: '나만 볼 수 있습니다. 나중에 자료 옆에서 공개로 바꿀 수 있어요.', teachers: '강사로 등록된 모든 분이 볼 수 있습니다. (훈련생에게는 안 보임)', all: '훈련생을 포함한 모든 사용자가 볼 수 있습니다.' }[v]; }
$('#att-vis').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) setVis(b.dataset.v); });
function openAttModal(uid) {
  attUid = uid; const L = cur(); const u = L.units.find(x => x.id === uid);
  $('#att-target').textContent = `${lessonNo(L) ? L.no + '과 · ' : ''}${plain(u.title)}`;
  $('#att-form').reset(); setKind('note'); setVis('private'); $('#modal').hidden = false; $('#att-title').focus();
}
function setKind(k) { attKind = k; $$('#att-kind button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); $$('#att-form [data-for]').forEach(l => l.hidden = l.dataset.for !== k); }
$('#att-kind').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) setKind(b.dataset.k); });
$('#att-cancel').addEventListener('click', () => $('#modal').hidden = true);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });
$('#att-form').addEventListener('submit', async e => {
  e.preventDefault();
  const a = { id: uidGen('a'), lid: st.lid, uid: attUid, kind: attKind, title: $('#att-title').value.trim(), at: Date.now(),
    vis: attVis === 'all' && !isAdmin() ? 'teachers' : attVis, authorName: (st.me && st.me.name || '').slice(0, 60), author: myUid() };
  if (attKind === 'note') a.text = $('#att-text').value.trim();
  if (attKind === 'link') { a.url = $('#att-url').value.trim(); if (!/^https?:\/\//.test(a.url)) { toast('https:// 로 시작하는 주소를 넣어 주세요'); return; } }
  if (attKind === 'image') {
    const file = $('#att-file').files[0]; if (!file) { toast('사진 파일을 골라 주세요'); return; }
    const r = await editImage(file).catch(() => null); if (!r) { toast('사진 넣기를 취소했습니다'); return; } a.img = r.dataUrl;
  }
  const btn = $('#att-form .primary'); btn.disabled = true;
  try { await Store.addAtt(a); $('#modal').hidden = true; refreshAtts(); toast(`자료를 추가했습니다 · ${VIS[a.vis][0]} ${VIS[a.vis][1]}`); }
  catch (err) { toast('추가하지 못했습니다: ' + err.message); }
  finally { btn.disabled = false; }
});
$('#lightbox').addEventListener('click', () => $('#lightbox').hidden = true);
async function compressImage(file) {
  const bmp = await createImageBitmap(file); let scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  for (let round = 0; round < 3; round++) {
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.7, 0.55]) { const url = c.toDataURL('image/jpeg', q); if (url.length < 850000) return url; }
    scale *= 0.7;
  }
  throw new Error('too big');
}

/* ---------------- 원본 보기 ---------------- */
function showPage(p, silent) {
  const L = cur(); if (!L || !p) return; st.pg = String(p);
  const img = $('#pg-img'); const want = st.pg; img.alt = '원본 불러오는 중…'; img.removeAttribute('src');
  B.pageUrl(want).then(url => { if (st.pg !== want) return; if (url) { img.src = url; img.alt = '원본 교재 ' + pageLabel(want); } else img.alt = '이 쪽의 원본 사진이 아직 없습니다'; }, () => { img.alt = '원본을 불러오지 못했습니다'; });
  $('#pg-label').textContent = pageLabel(st.pg);
  const i = L.pages.indexOf(st.pg); $('#pg-prev').disabled = i <= 0; $('#pg-next').disabled = i >= L.pages.length - 1;
  if (!silent) $('#orig-view').scrollTop = 0;
}
$('#pg-prev').addEventListener('click', () => { const L = cur(); const i = L.pages.indexOf(st.pg); if (i > 0) showPage(L.pages[i - 1]); });
$('#pg-next').addEventListener('click', () => { const L = cur(); const i = L.pages.indexOf(st.pg); if (i < L.pages.length - 1) showPage(L.pages[i + 1]); });
$('#pg-zoom').addEventListener('click', () => $('#orig-view').classList.toggle('zoom'));
function setPanelTab(p) { $$('.ptabs button').forEach(b => b.classList.toggle('on', b.dataset.p === p)); $$('#panel [data-pp]').forEach(s => s.hidden = s.dataset.pp !== p); $('#panel-title').textContent = { notes: '내 노트', files: '자료', orig: '원본 보기', bible: '성경' }[p]; if (p === 'bible') ensureBible(); }
$('.ptabs').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (!b) return; setPanelTab(b.dataset.p); setOrig(b.dataset.p === 'orig' || b.dataset.p === 'bible'); });
/* 성경 패널 */
let bibleReady = false;
function ensureBible() { if (bibleReady) return; bibleReady = true; initBible($('#bible')); bibleOpen('요 3:16'); }
function openBible(ref) {
  setPanelTab('bible'); setOrig(true);
  if (isMob() || matchMedia('(max-width:1199px)').matches) { openPanel(); tabOn('bible'); }
  bibleOpen(ref);
}
function setOrig(on) { document.body.classList.toggle('orig-on', on && !isMob()); $('#btn-orig').setAttribute('aria-pressed', on); }
function openOrig(p) {
  if (p) showPage(p);
  setPanelTab('orig'); setOrig(true);
  if (isMob() || matchMedia('(max-width:1199px)').matches) openPanel();
}
$('#btn-orig').addEventListener('click', () => {
  const on = $('#btn-orig').getAttribute('aria-pressed') !== 'true';
  if (on) { const first = $('#reader .blk[data-page]'); openOrig(isMob() && first ? first.dataset.page : null); }
  else { setOrig(false); setPanelTab('notes'); if (isMob() || matchMedia('(max-width:1199px)').matches) closeSheets(); }
});

let io = null;
function observeBlocks() {
  if (io) io.disconnect();
  const root = isMob() ? null : $('#reader');
  const vis = new Map();
  io = new IntersectionObserver(ents => {
    ents.forEach(en => { if (en.isIntersecting) vis.set(en.target, en.boundingClientRect.top); else vis.delete(en.target); });
    let top = null, tv = Infinity; vis.forEach((v, el) => { const t = el.getBoundingClientRect().top; if (t < tv && t > -40) { tv = t; top = el; } });
    if (!top) return;
    if ($('#pg-follow').checked && top.dataset.page !== st.pg) showPage(top.dataset.page, true);
    const sec = top.closest('.unit'); if (sec && !isMob() && sec.id !== st.visibleUnit) { st.visibleUnit = sec.id; $$('#toc .units button').forEach(b => b.classList.toggle('on', cur().body[+b.dataset.unit].id === sec.id)); history.replaceState(null, '', '#' + sec.id); }
  }, { root, rootMargin: '-10% 0px -55% 0px' });
  $$('#reader .blk, #reader .hero').forEach(b => io.observe(b));
}

/* ---------------- 검색 ---------------- */
async function search(q) {
  const res = $('#results'), toc = $('#toc');
  if (!q) { res.hidden = true; toc.hidden = false; return; }
  let ready;
  if (st.scope === 'books') {
    const vis = st.library.filter(canSee).filter(b => b.id === st.book || b.role === 'teacher' || !b.series || (chosenEdition(b.series) || {}).id === b.id); await Promise.all(vis.map(b => loadBookIndex(b.id).catch(() => null)));
    ready = vis.flatMap(b => ((st.indexes[b.id] || {}).lessons || []).filter(l => l.ready).map(l => ({ ...l, book: b })));
  } else ready = st.index.lessons.filter(l => l.ready).map(l => ({ ...l, book: curBook() }));
  await Promise.all(ready.map(l => loadLesson(l.id)));
  const out = [];
  const snip = (t, i) => { const s = Math.max(0, i - 20); return (s ? '…' : '') + t.slice(s, i + q.length + 30) + (i + q.length + 30 < t.length ? '…' : ''); };
  const hl = s => esc(s).split(esc(q)).join(`<mark>${esc(q)}</mark>`);
  if (st.scope === 'mine') {
    const g = {}; Store.marks().forEach(m => { const k = m.gid; g[k] = g[k] || m; });
    Object.values(g).forEach(m => { const t = (m.note || '') + ' ' + m.quote; const i = t.indexOf(q); if (i >= 0) out.push({ lid: m.lid, block: m.block, label: '내 메모', text: snip(t, i) }); });
    Object.entries(Store.answers()).forEach(([id, a]) => { const i = a.t.indexOf(q); if (i >= 0) out.push({ lid: id.slice(0, 3), block: id, label: '내 답', text: snip(a.t, i) }); });
    Store.atts().forEach(a => { if (!st.lessons[a.lid]) return; const t = a.title + ' ' + (a.text || '') + ' ' + (a.url || ''); const i = t.indexOf(q); if (i >= 0) out.push({ lid: a.lid, block: (st.lessons[a.lid].units.find(u => u.id === a.uid) || { blocks: [{}] }).blocks[0].id, label: '추가 자료', text: snip(t, i) }); });
  } else {
    ready.filter(l => st.scope !== 'lesson' || l.id === st.lid).forEach(l => {
      const L = st.lessons[l.id];
      L.units.forEach(u => u.blocks.forEach(b => {
        const t = plain((b.ref ? '[' + b.ref + '] ' : '') + (b.text || '') + (b.rows ? b.rows.flat().join(' ') : ''));
        const i = t.indexOf(q); if (i < 0) return;
        out.push({ lid: l.id, block: b.id, label: `${st.scope === 'books' ? (l.book.short || l.book.title) + ' · ' : ''}${lessonNo(L) ? L.no + '과' : L.title} · ${u.title === '표지' ? '표지' : plain(u.title)} · ${pageLabel(b.page)}`, text: snip(t, i), q });
      }));
    });
  }
  toc.hidden = true; res.hidden = false;
  res.innerHTML = `<p class="res-count">「${esc(q)}」 ${out.length}건${out.length > 200 ? ' · 앞의 200건만 표시' : ''}</p>` +
    out.slice(0, 200).map((o, i) => `<button type="button" class="res" data-i="${i}"><b>${esc(o.label)}</b>${hl(o.text)}</button>`).join('');
  res.onclick = e => { const b = e.target.closest('.res'); if (!b) return; const o = out[+b.dataset.i]; closeSheets(); openLesson(o.lid, 0, o.block, o.q ? q : null); };
}
let qT; $('#q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => search($('#q').value.trim()), 200); });
$('#scope').addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (!b) return; st.scope = b.dataset.s; $$('#scope button').forEach(x => x.classList.toggle('on', x === b)); search($('#q').value.trim()); });

/* ---------------- 시트 · 탭(폰) · 패널(패드) ---------------- */
function openPanel() { document.body.classList.add('show-panel'); document.body.classList.remove('show-nav'); $('#btn-panel').setAttribute('aria-pressed', 'true'); tabOn(isMob() && $('.ptabs .on').dataset.p === 'notes' ? 'notes' : 'read'); }
function closeSheets() {
  document.body.classList.remove('show-nav', 'show-panel'); $('#btn-panel').setAttribute('aria-pressed', 'false'); tabOn('read');
  if (isMob()) { setOrig(false); $('#btn-orig').setAttribute('aria-pressed', 'false'); }
}
function tabOn(t) { $$('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); }
$('#tabbar').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return; const t = b.dataset.tab;
  if (t === 'read') { closeSheets(); return; }
  if (t === 'notes') { setPanelTab('notes'); openPanel(); tabOn('notes'); return; }
  if (t === 'bible') { setPanelTab('bible'); openPanel(); tabOn('bible'); return; }
  document.body.classList.remove('show-panel'); document.body.classList.add('show-nav'); tabOn(t);
  $('#nav-title').textContent = t === 'search' ? '검색' : '목차';
  if (t === 'search') setTimeout(() => $('#q').focus(), 250);
});
$$('[data-close]').forEach(b => b.addEventListener('click', closeSheets));
$('#btn-panel').addEventListener('click', () => document.body.classList.contains('show-panel') ? closeSheets() : openPanel());
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideBar(); closeNote(); $('#modal').hidden = true; $('#lightbox').hidden = true; $('#ttsm').hidden = true; $('#inst').hidden = true; $('#trm').hidden = true; $('#tre').hidden = true; } });

/* 글자 크기 */
const FS = [15, 16, 17, 18, 20, 22];
function setFs(v) { document.documentElement.style.setProperty('--fs', v + 'px'); Store.setPref('fs', v); }
$('#fs-up').addEventListener('click', () => { const i = FS.indexOf(Store.pref('fs', 17)); setFs(FS[Math.min(FS.length - 1, i + 1)]); });
$('#fs-dn').addEventListener('click', () => { const i = FS.indexOf(Store.pref('fs', 17)); setFs(FS[Math.max(0, i - 1)]); });

/* 화면 폭이 바뀌면(폰 ↔ 패드) 그 모양으로 다시 그림 */
mq.addEventListener('change', () => { if (!cur()) return; closeSheets(); setOrig(false); renderReader(); renderToc(); });

/* ---------------- 관리자: 교재 올리기 ---------------- */
let uplItems = [];
function classify(f) {
  const n = f.name;
  let m = n.match(/^index(?:_([a-z][a-z0-9]*))?\.json$/); if (m) return { kind: 'index', book: m[1] || null, label: '목차' + (m[1] ? ' · ' + m[1] : ''), order: 3 };
  m = n.match(/^([A-Z]\d\d)\.json$/); if (m) return { kind: 'lesson', lid: m[1], label: '본문 ' + m[1], order: 2 };
  m = n.match(/^tr_([a-z]{2})_([A-Z]\d\d)\.json$/); if (m) return { kind: 'tr', lang: m[1], lid: m[2], label: `번역 ${(TRL[m[1]] || {}).ko || m[1]} ${m[2]}`, order: 4 };
  m = n.match(/^p(.+)\.webp$/); if (m) return { kind: 'page', page: m[1], label: '원본 ' + (m[1].match(/^([a-z][a-z0-9]*)_/) || ['', ''])[1] + ' ' + pageLabel(m[1]), order: 1 };
  return null;
}
async function entriesToFiles(entry) {
  if (entry.isFile) return new Promise(res => entry.file(f => res([f]), () => res([])));
  if (!entry.isDirectory) return [];
  const reader = entry.createReader(); let all = [];
  for (;;) { const batch = await new Promise(res => reader.readEntries(res, () => res([]))); if (!batch.length) break; all = all.concat(batch); }
  return (await Promise.all(all.map(entriesToFiles))).flat();
}
function addUplFiles(files) {
  files.forEach(f => { const c = classify(f); if (!c) return; uplItems = uplItems.filter(x => x.file.name !== f.name); uplItems.push({ file: f, ...c, status: '대기' }); });
  uplItems.sort((a, b) => a.order - b.order || a.file.name.localeCompare(b.file.name, 'ko', { numeric: true }));
  renderUpl();
}
function renderUpl() {
  const n = { index: 0, lesson: 0, page: 0, tr: 0 }; uplItems.forEach(x => n[x.kind]++);
  $('#upl-sum').textContent = uplItems.length ? `목차 ${n.index} · 본문 ${n.lesson}과 · 원본 사진 ${n.page}쪽${n.tr ? ` · 번역 ${n.tr}개` : ''}` : '아직 고른 파일이 없습니다';
  $('#upl-list').innerHTML = uplItems.map(x => `<li><span>${esc(x.label)}</span><small>${esc(x.file.name)}</small><b class="${x.status === '완료' ? 'ok' : x.status.startsWith('실패') ? 'bad' : ''}">${esc(x.status)}</b></li>`).join('');
  $('#upl-go').disabled = !uplItems.length || uplItems.every(x => x.status === '완료');
}
const readText = f => f.text();
const readDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
async function runUpload() {
  $('#upl-go').disabled = true;
  // 1) 목차 파일에서 교재 정보(이름·공개 대상 등)를, 본문 파일에서 과·쪽 정보를 먼저 읽음
  const indexIn = {}, lessonsIn = {};
  for (const x of uplItems.filter(x => x.kind === 'index')) {
    try { const o = JSON.parse(await readText(x.file)); const id = (o.meta && o.meta.id) || x.book || 'jeja'; indexIn[id] = o; x.bookId = id; } catch (e) { x.status = '실패: 파일 형식 오류'; }
  }
  for (const x of uplItems.filter(x => x.kind === 'lesson')) { try { lessonsIn[x.lid] = JSON.parse(await readText(x.file)); } catch (e) { x.status = '실패: 파일 형식 오류'; } }
  await loadLibrary().catch(() => {});
  const metaOf = id => { const o = indexIn[id]; const ex = bookById(id) || {};
    const m = (o && o.meta) || {};
    return { ...(id === 'jeja' ? JEJA : {}), ...m, ...ex, id, access: ex.access || m.access || 'all', indexDoc: id === 'jeja' ? '_index' : '_index_' + id,
      title: m.title || ex.title || (o && o.book) || id }; };
  const bookOfPrefix = c => { const ix = Object.values(indexIn).find(o => o.meta && o.meta.prefix === c); return ix ? ix.meta.id : ((st.library.find(b => b.prefix === c) || {}).id || 'jeja'); };
  const lidBook = lid => (lessonsIn[lid] && lessonsIn[lid].book) || bookOfPrefix(lid[0]);
  const pageBook = p => { const m = String(p).match(/^([a-z][a-z0-9]*)_/); return m ? m[1] : 'jeja'; };
  const pageLid = {}; Object.values(lessonsIn).forEach(L => (L.pages || []).forEach(p => pageLid[p] = L.id));
  const todo = uplItems.filter(x => x.status !== '완료' && !x.status.startsWith('실패'));
  const trBooks = {};
  const one = async x => {
    x.status = '올리는 중'; renderUpl();
    try {
      if (x.kind === 'page') { const url = await readDataUrl(x.file); if (url.length > 890000) throw new Error('사진이 너무 큼'); await B.putPage(x.page, pageLid[x.page], url, metaOf(pageBook(x.page)).access); }
      if (x.kind === 'lesson') await B.putLesson(x.lid, lessonsIn[x.lid], metaOf(lidBook(x.lid)).access);
      if (x.kind === 'index') { const m = metaOf(x.bookId); await B.putIndex(indexIn[x.bookId], m.indexDoc, m.access); }
      if (x.kind === 'tr') { const o = JSON.parse(await readText(x.file)); const bid = o.book || lidBook(x.lid); await B.putTr(x.lid, x.lang, o, metaOf(bid).access); (trBooks[bid] = trBooks[bid] || new Set()).add(x.lang); }
      x.status = '완료';
    } catch (e) { x.status = '실패: ' + (e.code === 'permission-denied' ? '관리자 권한 없음' : e.message); }
    renderUpl();
  };
  for (const k of ['page', 'lesson', 'index', 'tr']) {
    const q = todo.filter(x => x.kind === k);
    while (q.length) await Promise.all(q.splice(0, 4).map(one));
  }
  const bad = uplItems.filter(x => x.status.startsWith('실패')).length;
  if (bad) { toast(`${bad}개를 올리지 못했습니다`); renderUpl(); return; }
  // 2) 서재 목록에 교재 등록(이미 있으면 정보만 새로) · 번역 언어 표시
  const ids = Object.keys(indexIn);
  Object.entries(trBooks).forEach(([bid, set]) => { const b = bookById(bid); if (b) b.langs = [...new Set([...(b.langs || []), ...set])]; });
  if (ids.length || Object.keys(trBooks).length) {
    ids.forEach(id => { const m = metaOf(id); const i = st.library.findIndex(b => b.id === id); const entry = { ...(i >= 0 ? st.library[i] : {}), ...m }; delete entry.lessons;
      if (i < 0 && entry.seriesDefault) st.library.forEach(b => { if (seriesOf(b) === seriesOf(entry)) b.seriesDefault = false; });   // 새 판을 처음 올리면 그 판이 기본판
      if (i >= 0) st.library[i] = entry; else st.library.push(entry); });
    try { await B.putLibrary(st.library); } catch (e) { toast('서재 목록을 저장하지 못했습니다: ' + (e.code || e.message)); return; }
  }
  toast('교재를 올렸습니다'); st.lessons = {}; st.indexes = {}; await loadLibrary();
  $('#upl').hidden = true; await showLibrary();
}
function openUploader() { uplItems = []; renderUpl(); $('#upl').hidden = false; }
$('#btn-admin').addEventListener('click', () => { closeSheets(); openUploader(); });
$('#upl-close').addEventListener('click', () => $('#upl').hidden = true);
$('#upl-files').addEventListener('change', e => { addUplFiles([...e.target.files]); e.target.value = ''; });
$('#upl-dir').addEventListener('change', e => { addUplFiles([...e.target.files]); e.target.value = ''; });
$('#upl-go').addEventListener('click', () => runUpload().catch(e => { toast('올리기 중 오류: ' + e.message); renderUpl(); }));
const drop = $('#upl-drop');
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', async e => {
  e.preventDefault();
  const items = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const files = items.length ? (await Promise.all(items.map(entriesToFiles))).flat() : [...e.dataTransfer.files];
  addUplFiles(files);
});



/* ---------------- 실시간 동기화 ----------------
 * 다른 기기(또는 다른 창)에서 칠하거나 메모·답·자료를 바꾸면 1~2초 안에 이 화면에도 반영됩니다.
 * 지금 글자를 고르거나 메모를 쓰는 중이면 끝날 때까지 잠깐 미뤘다가 반영합니다. */
let liveT = null, pendingParts = {}, unwatchAtts = null, attsFor = null;
function busyEditing() {
  const ae = document.activeElement;
  return drawing || !bar.hidden || (!pop.hidden && pop.classList.contains('editing')) || !getSelection().isCollapsed;
}
function flushLive() {
  clearTimeout(liveT);
  if (busyEditing()) { liveT = setTimeout(flushLive, 1200); return; }
  const parts = pendingParts; pendingParts = {};
  if (parts.marks || parts.answers || parts.done) {
    if (parts.marks) applyMarks();
    renderNotes(); renderToc();
    if (parts.answers) $$('#reader textarea.ans').forEach(ta => { if (document.activeElement !== ta) { const a = Store.answers()[ta.dataset.for]; ta.value = a ? a.t : ''; } });
    if (parts.done && isMob()) $$('.chips [data-unit]').forEach(c => { const u = cur() && cur().body[+c.dataset.unit]; if (u) c.classList.toggle('done', !!Store.done()[u.id]); });
  }
  if (parts.atts) refreshAtts();
}
function onLive(part) {
  Store.setRemote(part); Object.keys(part).forEach(k => pendingParts[k] = 1);
  clearTimeout(liveT); liveT = setTimeout(flushLive, 150);
}
function watchLessonAtts(lid) {
  if (attsFor === lid) return; if (unwatchAtts) unwatchAtts(); attsFor = lid;
  unwatchAtts = B.watchAtts(lid, list => { Store.setRemoteAtts(lid, list); if (lid === st.lid) { pendingParts.atts = 1; clearTimeout(liveT); liveT = setTimeout(flushLive, 150); } });
}

/* 다른 기기에서 쓴 내용: 앱으로 돌아올 때마다(20초 간격) 다시 불러옴 */
let lastSync = Date.now();
async function syncNow(force) {
  if (!cur() || (!force && Date.now() - lastSync < 20000)) return; lastSync = Date.now();
  try {
    await Store.load(); await Store.loadAtts(st.lid);
    applyMarks(); renderNotes(); refreshAtts(); renderToc();
    $$('#reader textarea.ans').forEach(ta => { if (document.activeElement !== ta) { const a = Store.answers()[ta.dataset.for]; ta.value = a ? a.t : ''; } });
  } catch (e) { console.error(e); }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
addEventListener('focus', () => syncNow());


/* ---------------- 관리자: 사용자 관리 (구글 메일 초대) ---------------- */
const ROLE_KO = { admin: '관리자', teacher: '강사', member: '훈련생' };
let ppData = { invites: [], members: [], me: null }, ppFilter = 'all', ppEdit = null, ppConfirm = null;
const WK = ['일', '월', '화', '수', '목', '금', '토'];
const pad = n => String(n).padStart(2, '0');
const fmtT = t => { const d = new Date(t), now = new Date(); const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return '오늘 ' + hm;
  if (d.toDateString() === new Date(now - 864e5).toDateString()) return '어제 ' + hm;
  return `${d.getFullYear() !== now.getFullYear() ? d.getFullYear() + '. ' : ''}${d.getMonth() + 1}/${d.getDate()}(${WK[d.getDay()]}) ${hm}`; };
const fmtD = t => t ? new Date(t).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' }) : '';
function peopleRows() {
  const rows = new Map();
  ppData.invites.forEach(iv => rows.set(iv.id, { email: iv.id, name: iv.name || '', role: iv.role || 'member', memo: iv.memo || '', active: iv.active !== false, invite: iv, member: null }));
  ppData.members.forEach(m => {
    const key = (m.email || '').toLowerCase() || 'uid:' + m.uid;
    const r = rows.get(key) || { email: m.email || '', name: m.name || '', role: m.role, memo: '', active: true, invite: null, member: null };
    r.member = m; r.role = m.role || r.role; if (!r.name) r.name = m.name || ''; rows.set(key, r);
  });
  return [...rows.values()].map(r => ({ ...r, status: !r.active ? 'off' : r.member ? 'on' : 'wait', me: r.member && r.member.uid === ppData.me }))
    .sort((a, b) => ({ on: 0, wait: 1, off: 2 }[a.status] - { on: 0, wait: 1, off: 2 }[b.status]) || (a.name || a.email).localeCompare(b.name || b.email, 'ko'));
}
function renderPeople() {
  const q = $('#pp-q').value.trim().toLowerCase();
  const rows = peopleRows().filter(r => (ppFilter === 'all' || r.status === ppFilter) && (!q || [r.name, r.email, r.memo].join(' ').toLowerCase().includes(q)));
  const STAT = { on: ['사용 중', 'on'], wait: ['가입 전', 'wait'], off: ['중지', 'off'] };
  $('#pp-list').innerHTML = rows.map(r => {
    const key = esc(r.email || 'uid:' + (r.member && r.member.uid));
    if (ppEdit === key) return `<li class="pp-item editing" data-k="${key}">
      <div class="pp-edit"><label>이름<input class="pe-name" value="${esc(r.name)}"></label>
      <label>역할<select class="pe-role">${Object.entries(ROLE_KO).map(([k, v]) => `<option value="${k}" ${k === r.role ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="full">메모<textarea class="pe-memo" rows="2">${esc(r.memo)}</textarea></label></div>
      <div class="pp-btns"><button type="button" class="ghost" data-act="cancel">취소</button><button type="button" class="primary" data-act="save">저장</button></div></li>`;
    const conf = ppConfirm === key;
    return `<li class="pp-item ${r.status}" data-k="${key}">
      <div class="pp-main"><b>${esc(r.name || r.email || '(이름 없음)')}</b>${r.me ? '<span class="pp-me">나</span>' : ''}
        <span class="pp-role r-${r.role}">${ROLE_KO[r.role] || r.role}</span><span class="pp-stat s-${STAT[r.status][1]}">${STAT[r.status][0]}</span></div>
      ${r.member && r.member.lastLogin ? `<div class="pp-last">최근 접속 <b>${fmtT(r.member.lastLogin)}</b>${r.member.loginCount ? ` · 총 ${r.member.loginCount}회` : ''}${r.member.lastDev ? ` · ${esc(r.member.lastDev)}` : ''}</div>` : r.member ? '<div class="pp-last">접속 기록 없음</div>' : ''}
      <div class="pp-sub">${esc(r.email || '메일 정보 없음(직접 등록)')}${r.invite && r.invite.createdAt ? ` · 등록 ${fmtD(r.invite.createdAt)}` : ''}${r.member && r.member.joinedAt ? ` · 가입 ${fmtD(r.member.joinedAt)}` : ''}${r.invite && r.invite.stoppedAt && r.status === 'off' ? ` · 중지 ${fmtD(r.invite.stoppedAt)}` : ''}</div>
      ${r.memo ? `<p class="pp-memo">${esc(r.memo)}</p>` : ''}
      <div class="pp-btns">
        ${r.email ? '<button type="button" class="ghost" data-act="logs">접속 기록</button>' : ''}
        <button type="button" class="ghost" data-act="edit">수정</button>
        ${r.me ? '' : r.status === 'off'
          ? `<button type="button" class="ghost" data-act="on">다시 허용</button><button type="button" class="ghost danger" data-act="${conf ? 'del!' : 'del'}">${conf ? '정말 기록 삭제' : '기록 삭제'}</button>`
          : `<button type="button" class="ghost danger" data-act="${conf ? 'off!' : 'off'}">${conf ? '정말 중지할까요?' : '사용 중지'}</button>`}
      </div></li>`;
  }).join('') || '<li class="empty">해당하는 사람이 없습니다.</li>';
}
async function loadPeople() {
  $('#pp-list').innerHTML = '<li class="empty">불러오는 중…</li>';
  try { ppData = await B.listPeople(); renderPeople(); } catch (e) { $('#pp-list').innerHTML = `<li class="empty">불러오지 못했습니다: ${esc(e.code || e.message)}</li>`; }
}
$('#btn-people').addEventListener('click', () => { closeSheets(); $('#people').hidden = false; ppEdit = null; ppConfirm = null; setPpTab('users'); loadPeople(); });

/* 접속 기록 (관리자만) */
const KIND = { in: ['접속', 'ok'], denied: ['미등록 시도', 'bad'], stopped: ['중지된 계정 시도', 'bad'] };
let logs = [], logsEnd = false, logWho = '', logKind = 'all';
function setPpTab(t, who) {
  $$('#pp-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('#pp-users').hidden = t !== 'users'; $('#pp-logs').hidden = t !== 'logs';
  if (t === 'logs') { if (who !== undefined) logWho = who; if (!logs.length) loadLogs(); else renderLogs(); }
}
$('#pp-tabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) setPpTab(b.dataset.t, b.dataset.t === 'logs' ? '' : undefined); });
async function loadLogs(more) {
  const btn = $('#lg-more'); btn.disabled = true;
  if (!more) { logs = []; logsEnd = false; $('#lg-list').innerHTML = '<li class="empty">불러오는 중…</li>'; }
  try {
    const got = await B.listLogs(more && logs.length ? logs[logs.length - 1].at : null);
    logs = logs.concat(got); logsEnd = got.length < 300; renderLogs();
  } catch (e) { $('#lg-list').innerHTML = `<li class="empty">불러오지 못했습니다: ${esc(e.code || e.message)}<br>보안 규칙 v0.5를 게시했는지 확인해 주세요.</li>`; }
  finally { btn.disabled = false; }
}
function logRows() {
  return logs.filter(l => (!logWho || l.email === logWho) && (logKind === 'all' || (logKind === 'in' ? l.kind === 'in' : l.kind !== 'in')));
}
function renderLogs() {
  const who = new Map(); logs.forEach(l => { if (l.email && !who.has(l.email)) who.set(l.email, l.name || l.email); });
  if (logWho && !who.has(logWho)) who.set(logWho, logWho);
  $('#lg-who').innerHTML = `<option value="">모든 사람</option>` + [...who].sort((a, b) => a[1].localeCompare(b[1], 'ko')).map(([e, n]) => `<option value="${esc(e)}" ${e === logWho ? 'selected' : ''}>${esc(n)} (${esc(e)})</option>`).join('');
  const rows = logRows(); let day = '';
  const people = new Set(rows.filter(l => l.kind === 'in').map(l => l.email));
  $('#lg-sum').textContent = rows.length ? `${rows.length}건 · 접속한 사람 ${people.size}명${logsEnd ? '' : ' · 더 오래된 기록은 [더 불러오기]'}` : '';
  $('#lg-list').innerHTML = rows.map(l => {
    const d = new Date(l.at); const dk = `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} (${WK[d.getDay()]})`;
    const head = dk !== day ? `<li class="lg-day">${dk}</li>` : ''; day = dk;
    const [kt, kc] = KIND[l.kind] || [l.kind, ''];
    return `${head}<li class="lg-row"><span class="lg-t">${pad(d.getHours())}:${pad(d.getMinutes())}</span>
      <span class="lg-who"><b>${esc(l.name || '(이름 없음)')}</b>${l.role ? ` <span class="pp-role r-${l.role}">${ROLE_KO[l.role] || l.role}</span>` : ''}<small>${esc(l.email || '')}</small></span>
      <span class="lg-dev">${esc(l.dev || '')}</span><span class="lg-k k-${kc}">${kt}</span></li>`;
  }).join('') || '<li class="empty">기록이 없습니다. (v0.11부터 로그인할 때마다 쌓입니다)</li>';
  $('#lg-more').hidden = logsEnd;
}
$('#lg-who').addEventListener('change', e => { logWho = e.target.value; renderLogs(); });
$('#lg-kind').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (!b) return; logKind = b.dataset.k; $$('#lg-kind button').forEach(x => x.classList.toggle('on', x === b)); renderLogs(); });
$('#lg-more').addEventListener('click', () => loadLogs(true));
$('#lg-reload').addEventListener('click', () => loadLogs());
$('#lg-csv').addEventListener('click', () => {
  const rows = logRows(); if (!rows.length) { toast('내려받을 기록이 없습니다'); return; }
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['날짜', '시각', '이름', '구글 메일', '역할', '결과', '기기'].map(q).join(',')].concat(rows.map(l => { const d = new Date(l.at);
    return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${pad(d.getHours())}:${pad(d.getMinutes())}`, l.name, l.email, ROLE_KO[l.role] || '미등록', (KIND[l.kind] || [l.kind])[0], l.dev].map(q).join(','); }));
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); const n = new Date();
  a.href = URL.createObjectURL(blob); a.download = `제자의삶_접속기록_${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('엑셀에서 열 수 있는 파일(CSV)로 내려받았습니다');
});
$('#pp-close').addEventListener('click', () => $('#people').hidden = true);
$('#pp-q').addEventListener('input', renderPeople);
$('#pp-filter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; ppFilter = b.dataset.f; $$('#pp-filter button').forEach(x => x.classList.toggle('on', x === b)); renderPeople(); });
$('#pp-form').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('#pp-email').value.trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { $('#pp-msg').textContent = '메일 주소를 확인해 주세요'; return; }
  const btn = $('#pp-submit'); btn.disabled = true;
  try {
    const exists = ppData.invites.find(x => x.id === email);
    await B.saveInvite(email, { email, name: $('#pp-name').value.trim(), role: $('#pp-role').value, memo: $('#pp-memo').value.trim(), active: true,
      ...(exists ? { updatedAt: Date.now() } : { createdAt: Date.now(), createdBy: st.me && st.me.email || '' }) });
    $('#pp-form').reset(); $('#pp-msg').textContent = ''; toast(`${email} 을(를) 등록했습니다`); await loadPeople();
  } catch (err) { $('#pp-msg').textContent = '등록하지 못했습니다: ' + (err.code || err.message); }
  finally { btn.disabled = false; }
});
$('#pp-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const li = b.closest('[data-k]'); const key = li.dataset.k;
  const r = peopleRows().find(x => (x.email || 'uid:' + (x.member && x.member.uid)) === key); if (!r) return;
  const act = b.dataset.act;
  try {
    if (act === 'logs') { setPpTab('logs', r.email); return; }
    if (act === 'edit') { ppEdit = key; ppConfirm = null; return renderPeople(); }
    if (act === 'cancel') { ppEdit = null; return renderPeople(); }
    if (act === 'off' || act === 'del') { ppConfirm = key; renderPeople(); setTimeout(() => { if (ppConfirm === key) { ppConfirm = null; renderPeople(); } }, 4000); return; }
    b.disabled = true;
    if (act === 'save') {
      const name = $('.pe-name', li).value.trim(), role = $('.pe-role', li).value, memo = $('.pe-memo', li).value.trim();
      if (r.email) await B.saveInvite(r.email, { email: r.email, name, role, memo, active: r.active, updatedAt: Date.now() });
      if (r.member && r.member.role !== role) await B.setMemberRole(r.member.uid, role);
      ppEdit = null; toast('저장했습니다');
    }
    if (act === 'off!') {
      if (r.email) await B.saveInvite(r.email, { email: r.email, name: r.name, role: r.role, memo: r.memo, active: false, stoppedAt: Date.now() });
      if (r.member) await B.removeMember(r.member.uid);
      ppConfirm = null; toast(`${r.name || r.email} 사용을 중지했습니다`);
    }
    if (act === 'on') { await B.saveInvite(r.email, { active: true, restartedAt: Date.now() }); toast('다시 허용했습니다. 그 메일로 로그인하면 들어옵니다'); }
    if (act === 'del!') { await B.deleteInvite(r.email); ppConfirm = null; toast('기록을 삭제했습니다'); }
    await loadPeople();
  } catch (err) { toast('처리하지 못했습니다: ' + (err.code || err.message)); b.disabled = false; }
});

/* ---------------- 서재 화면 ---------------- */
const LOCK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';
function bookStats(id) {
  const ix = st.indexes[id]; if (!ix) return { pct: 0, lessons: 0 };
  const units = ix.lessons.filter(l => l.ready).flatMap(l => (l.units || []).filter(u => u.title !== '표지'));
  const done = Store.done(); const n = units.filter(u => done[u.id]).length;
  return { pct: units.length ? Math.round(n * 100 / units.length) : 0, lessons: ix.lessons.filter(l => l.no >= 1).length };
}
function resumeOf(id) {
  const ix = st.indexes[id]; const p = Store.pref(posKey(id), null); if (!ix || !p) return null;
  const l = ix.lessons.find(x => x.id === p.lid); if (!l) return null;
  const u = (l.units || []).filter(u => u.title !== '표지')[p.ui];
  return { lid: p.lid, ui: p.ui, text: `${l.no >= 1 ? l.no + '과 ' : ''}${l.title}${u ? ' · ' + plain(u.title) : ''}` };
}
function coverHTML(b, small) {
  return `<div class="cover cv-${esc(b.color || 'green')}${small ? ' sm' : ''}" aria-hidden="true"><small>${esc(b.tag || '')}</small><b>${esc(b.coverTitle || b.title)}</b><span>수원하나교회</span></div>`;
}
function hasMarksIn(b) {
  if (!b || !b.prefix) return false;
  return Store.marks().some(m => m.lid && m.lid[0] === b.prefix) || Object.keys(Store.answers()).some(id => id[0] === b.prefix);
}
function renderLibrary() {
  const vis = st.library.filter(canSee);
  const teacherOf = {};
  vis.forEach(b => { if (b.role === 'teacher' && b.pair && vis.some(x => x.id === b.pair)) teacherOf[b.pair] = b; });
  // 같은 교재의 여러 판은 카드 하나로: 내가 고른 판(없으면 기본판)만 보임
  const shown = vis.filter(b => !(b.role === 'teacher' && teacherOf[b.pair] === b)).filter(b => !b.series || (chosenEdition(b.series) || {}).id === b.id);
  const groups = []; shown.forEach(b => { const g = b.group || '교재'; let G = groups.find(x => x.name === g); if (!G) groups.push(G = { name: g, books: [] }); G.books.push(b); });
  const last = bookById(Store.pref('lastBook', '')); const lr = last && canSee(last) && resumeOf(last.id);
  $('#lib-body').innerHTML = (lr ? `<button type="button" class="lb-resume" data-open="${last.id}" data-resume="1">
        ${coverHTML(last, true)}<span class="lb-rt"><small>이어 읽기${last.edition ? ' · ' + esc(last.edition) : ''}</small><b>${esc(last.short || last.title)}</b><span>${esc(lr.text)}</span></span><span class="lb-go" aria-hidden="true">›</span></button>` : '') +
    groups.map(G => `<section class="lb-group"><h2>${esc(G.name)}</h2>${G.books.map(b => {
      const t = teacherOf[b.id]; const sx = bookStats(b.id); const r = resumeOf(b.id); const ready = !!st.indexes[b.id];
      const eds = b.series ? editionsOf(b.series) : [b];
      const edSel = eds.length > 1 ? `<label class="lb-ed">판 <select data-ed="${esc(b.series)}">${eds.map(e => `<option value="${e.id}" ${e.id === b.id ? 'selected' : ''}>${esc(e.edition || e.id)}${e.seriesDefault ? ' (기본)' : ''}</option>`).join('')}</select></label>`
        : (b.edition ? `<span class="lb-ed one">${esc(b.edition)}</span>` : '');
      const older = eds.filter(e => e.id !== b.id && hasMarksIn(e) && !Store.pref('imp_' + b.id + '_' + e.id, 0));
      const imp = older.map(e => `<button type="button" class="lb-imp" data-imp-from="${e.id}" data-imp-to="${b.id}">↪ ${esc(e.edition || e.title)}의 내 형광펜·메모·답을 이 판으로 가져오기</button>`).join('');
      return `<article class="lb-card">
        <button type="button" class="lb-main" data-open="${b.id}" ${ready ? '' : 'disabled'}>${coverHTML(b)}
          <span class="lb-info"><b>${esc(b.title)}</b><span class="muted">${esc(b.sub || '')}</span>
          ${b.access === 'staff' ? `<span class="lb-lock">${LOCK_SVG} 강사 전용</span>` : ''}
          ${ready ? `<span class="lb-prog"><i style="width:${sx.pct}%"></i></span><span class="lb-meta">${sx.pct}% 읽음${r ? ' · ' + esc(r.text) : ''}</span>` : '<span class="lb-meta">아직 교재 데이터가 없습니다</span>'}</span></button>
        ${edSel ? `<div class="lb-edbar">${edSel}${eds.length > 1 ? '<span class="muted small">판마다 형광펜·메모가 따로 저장됩니다</span>' : ''}</div>` : ''}
        ${imp}
        ${t ? `<div class="lb-btns"><button type="button" class="primary" data-open="${b.id}">${r ? '이어 읽기' : '교재 열기'}</button><button type="button" class="lb-tbtn" data-open="${t.id}">${LOCK_SVG} ${esc(t.short || '교사 매뉴얼')}</button></div>
          <p class="muted small">교사 매뉴얼은 강사·관리자에게만 보입니다. 읽는 중에 위쪽 [교재 ↔ 교사용] 버튼으로 같은 과를 오갈 수 있어요.</p>` : ''}
      </article>`; }).join('')}</section>`).join('');
  if (!$('#bkm').hidden) renderBookAdmin();
}
/* ---------------- 관리자 메뉴 (서재 오른쪽 위 ⚙) ---------------- */
const admm = $('#admm');
function toggleAdmm(open) {
  open = open ?? admm.hidden; admm.hidden = !open; $('#btn-admm').setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { $('[data-adm="upload"]', admm).hidden = B.kind !== 'firebase'; const r = $('#btn-admm').getBoundingClientRect(); admm.style.top = (r.bottom + 8) + 'px'; admm.style.right = Math.max(8, document.documentElement.clientWidth - r.right) + 'px'; }
}
$('#btn-admm').addEventListener('click', e => { e.stopPropagation(); toggleAdmm(); });
document.addEventListener('pointerdown', e => { if (!admm.hidden && !admm.contains(e.target) && !e.target.closest('#btn-admm')) toggleAdmm(false); });
addEventListener('keydown', e => { if (e.key === 'Escape' && !admm.hidden) toggleAdmm(false); });
admm.addEventListener('click', e => {
  const b = e.target.closest('[data-adm]'); if (!b) return; toggleAdmm(false);
  const k = b.dataset.adm;
  if (k === 'books') { renderBookAdmin(); $('#bkm').hidden = false; }
  if (k === 'upload') openUploader();
  if (k === 'users' || k === 'logs') { closeSheets(); $('#people').hidden = false; ppEdit = null; ppConfirm = null; setPpTab(k, k === 'logs' ? '' : undefined); if (k === 'users') loadPeople(); }
});
/* 교재 관리: 모든 교재·판·교사용을 한 표에 같은 자리로 정렬 */
function renderBookAdmin() {
  const lib = st.library; const groups = [];
  const seen = new Set();
  const rowsOf = b => { const eds = b.series ? editionsOf(b.series) : [b]; return eds; };
  lib.slice().sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).forEach(b => {
    if (seen.has(b.id) || b.role === 'teacher') return;
    const eds = rowsOf(b); eds.forEach(e => seen.add(e.id));
    const t = lib.find(x => x.role === 'teacher' && x.pair && eds.some(e => e.id === x.pair)); if (t) seen.add(t.id);
    const g = b.group || '교재'; let G = groups.find(x => x.name === g); if (!G) groups.push(G = { name: g, items: [] });
    G.items.push({ eds, t });
  });
  lib.filter(b => !seen.has(b.id)).forEach(b => { let G = groups.find(x => x.name === '기타'); if (!G) groups.push(G = { name: '기타', items: [] }); G.items.push({ eds: [b] }); });
  const acc = b => `<div class="seg bkm-acc" role="group" aria-label="${esc(b.title)} 공개 대상"><button type="button" data-acc-v="all" data-acc-id="${b.id}" class="${b.access !== 'staff' ? 'on' : ''}">모든 사용자</button><button type="button" data-acc-v="staff" data-acc-id="${b.id}" class="${b.access === 'staff' ? 'on' : ''}">${LOCK_SVG} 강사·관리자</button></div>`;
  const row = (b, multi, kind) => `<div class="bkm-row${kind ? ' sub' : ''}">
      <div class="bkm-name"><b>${esc(b.short || b.title)}</b>${kind === 'teacher' ? '' : b.edition ? `<span class="bkm-ed">${esc(b.edition)} <button type="button" class="bkm-pen" data-edname="${b.id}" aria-label="판 이름 바꾸기">✎</button></span>` : `<button type="button" class="bkm-pen add" data-edname="${b.id}">+ 판 이름</button>`}${kind === 'teacher' ? '<span class="bkm-tag">교사용</span>' : ''}</div>
      <div class="bkm-def">${multi ? (b.seriesDefault ? '<span class="lb-def">기본판</span>' : `<button type="button" class="ghost" data-def="${b.id}">기본판으로</button>`) : '<span class="muted">—</span>'}</div>
      <div class="bkm-accw">${acc(b)}</div></div>`;
  $('#bkm-body').innerHTML = groups.map(G => `<section class="bkm-g"><h4>${esc(G.name)}</h4>${G.items.map(({ eds, t }) =>
    `<div class="bkm-book">${eds.map(e => row(e, eds.length > 1)).join('')}${t ? row(t, false, 'teacher') : ''}</div>`).join('')}</section>`).join('');
}
$('#bkm').addEventListener('click', async e => {
  if (e.target.id === 'bkm' || e.target.closest('#bkm-close')) { $('#bkm').hidden = true; return; }
  const a = e.target.closest('[data-acc-v]');
  if (a) { if (a.classList.contains('on')) return; await setBookAccessUI(bookById(a.dataset.accId), a.dataset.accV, a.closest('.bkm-acc')); return; }
  const df = e.target.closest('[data-def]'); if (df) { await setDefaultEd(df.dataset.def); return; }
  const en = e.target.closest('[data-edname]'); if (en) { await renameEd(en.dataset.edname); }
});

/* 이전 판의 내 표시(형광펜·밑줄·메모·사진)·답·읽음 표시를 새 판으로 옮기기
 * 같은 과 번호에서 같은 문장을 찾아 옮기고, 문장이 바뀐 곳은 '옮기지 못한 항목'으로 보여 줌 (이전 판에는 그대로 남음) */
function blockText(b) { const d = document.createElement('div'); d.innerHTML = blockHTML(b, null); const tx = d.querySelector('.tx'); return tx ? tx.textContent : null; }
const squash = t => String(t || '').replace(/\s+/g, '');
async function importEdition(fromId, toId) {
  const fb = bookById(fromId), tb = bookById(toId);
  const [fi, ti] = await Promise.all([loadBookIndex(fromId), loadBookIndex(toId)]);
  if (!fi || !ti) throw new Error('교재를 불러오지 못했습니다');
  const lmap = {}; fi.lessons.forEach(l => { const t = ti.lessons.find(x => x.no === l.no && x.ready); if (t) lmap[l.id] = t.id; });
  await Promise.all([...Object.keys(lmap), ...Object.values(lmap)].map(loadLesson));
  const flat = L => L.units.flatMap(u => u.blocks);
  const texts = new Map(); const tcache = (L, b) => { const k = b.id; if (!texts.has(k)) texts.set(k, blockText(b)); return texts.get(k); };
  const res = { marks: 0, answers: 0, done: 0, lost: [] };
  // 1) 형광펜·메모
  const groups = {}; Store.marks().filter(m => m.lid && m.lid[0] === fb.prefix && !m.tl).forEach(m => (groups[m.gid] = groups[m.gid] || []).push(m));
  for (const segs of Object.values(groups)) {
    const first = segs[0]; const nlid = lmap[first.lid]; const out = [];
    if (nlid) {
      const NL = st.lessons[nlid]; const nb = flat(NL);
      for (const sg of segs) {
        const oi = +String(sg.block).split('-B')[1] || 0; let best = null;
        nb.map((b, i) => ({ b, i, d: Math.abs(i + 1 - oi) })).sort((a, b) => a.d - b.d).some(({ b }) => {
          const t = tcache(NL, b); if (!t || !sg.quote) return false;
          let k = t.indexOf(sg.quote), pick = -1, bd = Infinity;
          while (k >= 0) { const dd = Math.abs(k - sg.s); if (dd < bd) { bd = dd; pick = k; } k = t.indexOf(sg.quote, k + 1); }
          if (pick >= 0) { best = { block: b.id, s: pick, e: pick + sg.quote.length }; return true; } return false;
        });
        if (!best) { out.length = 0; break; }
        out.push(best);
      }
    }
    const L0 = st.lessons[first.lid];
    if (!out.length) { res.lost.push({ kind: '표시', where: L0 ? (lessonNo(L0) ? L0.no + '과' : L0.title) : '', quote: segs.map(x => x.quote).join(' … '), note: first.note || '', lid: first.lid, block: first.block }); continue; }
    const gid = uidGen('g'); const at = Date.now();
    const photos = [];
    for (const pid of (first.photos || [])) { try { const img = await B.getPhoto(pid); if (img) { const np = uidGen('ph'); await B.putPhoto(np, { gid, img, at }); photos.push(np); } } catch (e) { console.warn(e); } }
    Store.addMarks(out.map((o, i) => ({ id: gid + '-' + i, gid, lid: nlid, block: o.block, s: o.s, e: o.e, quote: segs[i].quote, c: first.c, note: i === 0 ? (first.note || '') : '', photos: i === 0 ? photos : [], at: first.at || at })));
    res.marks++;
  }
  // 2) 답
  for (const [id, a] of Object.entries(Store.answers()).filter(([id]) => id[0] === fb.prefix)) {
    const olid = id.slice(0, 3), nlid = lmap[olid]; const OL = st.lessons[olid]; let target = null;
    if (nlid && OL) {
      const ob = flat(OL); const oi = ob.findIndex(b => b.id === id); const NL = st.lessons[nlid]; const nb = flat(NL);
      // 답 칸 바로 앞의 질문(또는 문장)을 새 판에서 찾고, 그 뒤의 답 칸으로
      let anchor = null; for (let i = oi; i >= 0 && !anchor; i--) { const t = tcache(OL, ob[i]); if (t && t.trim()) anchor = { i, t: squash(t), q: ob[i].t === 'q' && i === oi }; }
      if (anchor) {
        const ni = nb.findIndex(b => { const t = tcache(NL, b); return t && squash(t) === anchor.t; });
        if (ni >= 0) {
          if (nb[ni].t === 'q' && (anchor.q || ob[oi].t === 'lines')) target = nb[ni].id;
          else { const nx = nb.slice(ni + 1).find(b => b.t === 'lines' || b.t === 'q'); if (nx) target = nx.id; }
        }
      }
    }
    if (!target) { res.lost.push({ kind: '답', where: OL ? (lessonNo(OL) ? OL.no + '과' : OL.title) : '', quote: '', note: a.t, lid: olid, block: id }); continue; }
    if (!(Store.answers()[target] || {}).t) { await Store.setAnswer(target, a.t); res.answers++; }
  }
  // 3) 읽음 표시 (같은 과·같은 단원 제목)
  Object.keys(Store.done()).filter(u => u[0] === fb.prefix).forEach(uid => {
    const nlid = lmap[uid.slice(0, 3)]; const OL = st.lessons[uid.slice(0, 3)]; if (!nlid || !OL) return;
    const ou = OL.units.find(u => u.id === uid); const nu = ou && st.lessons[nlid].units.find(u => squash(u.title) === squash(ou.title));
    if (nu && !Store.done()[nu.id]) { Store.setDone(nu.id, true); res.done++; }
  });
  Store.setPref('imp_' + toId + '_' + fromId, Date.now());
  return res;
}
function showImport(res, fb, tb) {
  $('#imp-sum').innerHTML = `<b>${esc(fb.edition || fb.title)}</b> → <b>${esc(tb.edition || tb.title)}</b><br>형광펜·메모 <b>${res.marks}</b>개 · 답 <b>${res.answers}</b>개 · 읽음 표시 <b>${res.done}</b>개를 옮겼습니다.`;
  $('#imp-lost').innerHTML = res.lost.length ? `<p class="muted small">아래 ${res.lost.length}개는 새 판에서 문장이 바뀌어 자동으로 옮기지 못했습니다. 이전 판에는 그대로 남아 있으니, 눌러서 이전 판에서 확인하세요.</p>` +
    res.lost.map(x => `<button type="button" class="note" data-jump="${esc(x.block)}" data-lid="${esc(x.lid)}"><span class="kind">${esc(x.kind)} · ${esc(x.where)}</span>${x.quote ? `<q>${esc(x.quote.slice(0, 80))}</q>` : ''}${x.note ? esc(x.note.slice(0, 160)) : ''}</button>`).join('')
    : '<p class="muted small">모든 항목을 옮겼습니다.</p>';
  $('#imp').hidden = false;
}
$('#imp').addEventListener('click', e => {
  if (e.target.id === 'imp' || e.target.closest('#imp-close')) { $('#imp').hidden = true; return; }
  const j = e.target.closest('[data-jump]'); if (j) { $('#imp').hidden = true; openLesson(j.dataset.lid, 0, j.dataset.jump); }
});
async function showLibrary() {
  closeSheets(); if (tts) tts.rerendered();
  document.body.classList.add('lib-on'); $('#lib').hidden = false; $('#top-book').textContent = '서재'; $('#top-lesson').textContent = '';
  await Promise.all(st.library.filter(canSee).map(b => loadBookIndex(b.id).catch(() => null)));
  renderLibrary(); window.scrollTo(0, 0);
}
function hideLibrary() { document.body.classList.remove('lib-on'); $('#lib').hidden = true; }
async function openBook(id, lid = null, ui = 0, blockId = null, q = null) {
  const b = bookById(id); const ix = await loadBookIndex(id);
  if (!ix) { toast('이 교재를 열 수 없습니다'); return; }
  const changed = st.book !== id; st.book = id; st.index = ix;
  if (!lid) { const p = Store.pref(posKey(id), null); if (p && ix.lessons.some(l => l.id === p.lid && l.ready)) { lid = p.lid; ui = p.ui; } else lid = firstReady(); }
  if (!lid) { toast('아직 읽을 수 있는 과가 없습니다'); return; }
  hideLibrary(); Store.setPref('lastBook', id);
  $('#nav-book').textContent = bookLabel(b); $('#nav-book').title = bookLabel(b); updatePairBtn(); $('#btn-tr').hidden = !trLangsOf().length;
  if (b && b.series) Store.setPref('ed_' + b.series, id);
  if (changed) st.lid = null;
  await openLesson(lid, ui, blockId, q);
  updatePairBtn();
}
/* 교재 ↔ 교사 매뉴얼: 같은 과 번호로 이동 */
function pairOf(b) { const p = b && b.pair && bookById(b.pair); return p && canSee(p) ? p : null; }
function updatePairBtn() {
  const p = pairOf(curBook()); const btn = $('#btn-pair'); btn.hidden = !p;
  if (p) btn.innerHTML = p.role === 'teacher' ? `${LOCK_SVG}<span class="lbl"> 교사용</span>` : `<span aria-hidden="true">📘</span><span class="lbl"> 교재</span>`;
  if (p) btn.title = (p.role === 'teacher' ? '같은 과의 교사 매뉴얼로' : '같은 과의 교재로') + ' 이동';
}
$('#btn-pair').addEventListener('click', async () => {
  const p = pairOf(curBook()); if (!p) return; const L = cur();
  const ix = await loadBookIndex(p.id); if (!ix) { toast('열 수 없습니다'); return; }
  const same = L && L.no >= 1 ? ix.lessons.find(l => l.no === L.no && l.ready) : null;
  await openBook(p.id, same ? same.id : null, 0);
  if (same) toast(`${p.short || p.title} · ${same.no}과`);
});
$('#lib').addEventListener('click', async e => {
  if (e.target.closest('#lib-add')) { openUploader(); return; }
  const im = e.target.closest('[data-imp-from]');
  if (im) {
    const fb = bookById(im.dataset.impFrom), tb = bookById(im.dataset.impTo);
    if (!confirm(`${fb.edition || fb.title}에 표시한 형광펜·메모·답을 ${tb.edition || tb.title}으로 가져올까요?\n이전 판의 표시는 지워지지 않고 그대로 남습니다.`)) return;
    im.disabled = true; im.textContent = '가져오는 중…';
    try { const r = await importEdition(fb.id, tb.id); renderLibrary(); showImport(r, fb, tb); }
    catch (err) { toast('가져오지 못했습니다: ' + (err.code || err.message)); renderLibrary(); }
    return;
  }
  const o = e.target.closest('[data-open]'); if (!o || o.disabled) return;
  await openBook(o.dataset.open);
});
$('#lib').addEventListener('change', async e => {
  const ed = e.target.closest('[data-ed]'); if (ed) { Store.setPref('ed_' + ed.dataset.ed, ed.value); renderLibrary(); }
});
async function setDefaultEd(id) {
  const b = bookById(id); if (!confirm(`「${b.title}」 ${b.edition || ''}을(를) 기본판으로 할까요?\n처음 여는 사람과 판을 고르지 않은 사람에게 이 판이 보입니다.`)) return;
  st.library.forEach(x => { if (seriesOf(x) === seriesOf(b)) x.seriesDefault = x.id === b.id; });
  try { await B.putLibrary(st.library); toast('기본판을 바꿨습니다'); } catch (err) { toast('저장하지 못했습니다: ' + (err.code || err.message)); }
  renderLibrary(); renderBookAdmin();
}
async function renameEd(id) {
  const b = bookById(id); const v = prompt('판 이름 (예: 2026년 8월판, 2027 상반기판)', b.edition || ''); if (v == null || !v.trim()) return;
  b.edition = v.trim(); if (!b.series) b.series = b.id;
  try { await B.putLibrary(st.library); toast('판 이름을 바꿨습니다'); } catch (err) { toast('저장하지 못했습니다: ' + (err.code || err.message)); }
  renderLibrary(); renderBookAdmin();
}
async function setBookAccessUI(b, v, box) {
  const label = v === 'staff' ? '강사·관리자만' : '모든 사용자';
  if (!confirm(`「${b.title}」${b.edition ? ' ' + b.edition : ''} 공개 대상을 '${label}'(으)로 바꿀까요?\n본문·원본 사진·번역에 모두 적용되어 1~2분 걸릴 수 있습니다.`)) return;
  const btns = box ? $$('button', box) : []; btns.forEach(x => x.disabled = true);
  try {
    const ix = await loadBookIndex(b.id); const ids = ix.lessons.filter(l => l.ready).map(l => l.id);
    await Promise.all(ids.map(loadLesson));
    const pages = [...new Set(ids.flatMap(id => st.lessons[id].pages || []))];
    await B.setBookAccess(b.indexDoc || '_index', ids, pages, v, (n, t) => { $('#toast').textContent = `공개 대상 바꾸는 중… ${n}/${t}`; $('#toast').hidden = false; }, b.langs || []);
    b.access = v; await B.putLibrary(st.library);
    toast(`「${b.title}」 → ${label}`);
  } catch (err) { toast('바꾸지 못했습니다: ' + (err.code || err.message)); }
  finally { btns.forEach(x => x.disabled = false); renderLibrary(); renderBookAdmin(); }
}
[$('#btn-lib'), $('#btn-lib-m'), $('#nav-lib')].forEach(b => b.addEventListener('click', showLibrary));
$('.top .brand').addEventListener('click', () => { if (!document.body.classList.contains('lib-on') && st.me) showLibrary(); });


/* ---------------- 앱으로 설치하기 안내 ---------------- */
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (!$('#inst').hidden) renderInstall(); });
addEventListener('appinstalled', () => { installEvt = null; toast('설치했습니다. 홈 화면의 「제삶」 아이콘으로 여세요'); $('#inst').hidden = true; });
const SHARE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px" aria-label="공유"><path d="M12 3v12M8 7l4-4 4 4"></path><path d="M5 11v9h14v-9"></path></svg>';
const INSTALL_GUIDE = [
  { os: ['iphone', 'ipad'], title: '아이폰 · 아이패드', html: `
    <ol>
      <li><b>Safari</b>로 이 앱 주소를 엽니다. (카카오톡 안에서 열렸다면 오른쪽 아래 <b>⋯ → 다른 브라우저로 열기</b> 또는 <b>Safari로 열기</b>)</li>
      <li>화면 아래(아이패드는 위쪽 오른쪽)의 <b>공유 버튼 ${SHARE}</b>을 누릅니다.</li>
      <li>목록을 위로 밀어 <b>‘홈 화면에 추가’</b>를 누릅니다. 안 보이면 맨 아래 <b>‘작업 편집…’</b>에서 추가할 수 있습니다.</li>
      <li>이름이 <b>제삶</b>인지 확인하고 오른쪽 위 <b>추가</b>를 누릅니다.</li>
      <li>홈 화면의 <b>제삶</b> 아이콘으로 열고, 처음 한 번 Google 로그인을 합니다.</li>
    </ol>
    <p class="tip">아이폰의 Chrome에서도 주소창 오른쪽 공유 버튼 → ‘홈 화면에 추가’로 할 수 있지만, Safari가 가장 확실합니다.</p>` },
  { os: ['android'], title: '안드로이드 폰·태블릿 (갤럭시 등)', html: `
    <ol>
      <li><b>Chrome</b>으로 이 앱 주소를 엽니다.</li>
      <li>위의 <b>[지금 설치하기]</b> 버튼이 보이면 누르고 <b>설치</b>를 누르면 끝입니다.</li>
      <li>버튼이 없으면 오른쪽 위 <b>⋮</b> → <b>‘홈 화면에 추가’</b>(또는 <b>‘앱 설치’</b>) → <b>설치</b>를 누릅니다.</li>
      <li>홈 화면에 생긴 <b>제삶</b> 아이콘으로 엽니다.</li>
    </ol>
    <p class="tip">삼성 인터넷: 아래쪽 <b>≡ 메뉴</b> → <b>‘현재 페이지 추가’</b> → <b>‘홈 화면’</b>.</p>` },
  { os: ['mac'], title: '맥 (MacBook · iMac)', html: `
    <ol>
      <li><b>Chrome</b>: 주소창 오른쪽 끝의 <b>설치 아이콘(모니터에 ↓ 모양)</b>을 누르고 <b>설치</b>. 아이콘이 없으면 <b>⋮ → 전송, 저장, 공유 → 페이지를 앱으로 설치…</b></li>
      <li><b>Safari</b>(macOS 14 이상): 위쪽 메뉴 <b>파일 → Dock에 추가…</b> → <b>추가</b>.</li>
      <li><b>Edge</b>: <b>⋯ → 앱 → 이 사이트를 앱으로 설치</b>.</li>
      <li>Dock이나 Launchpad의 <b>제삶</b> 아이콘으로 엽니다.</li>
    </ol>` },
  { os: ['windows', 'chromebook', 'other'], title: '윈도우 PC · 크롬북', html: `
    <ol>
      <li><b>Chrome</b>: 주소창 오른쪽 끝의 <b>설치 아이콘(모니터에 ↓ 모양)</b> → <b>설치</b>. 없으면 <b>⋮ → 전송, 저장, 공유 → 페이지를 앱으로 설치…</b></li>
      <li><b>Edge</b>: <b>⋯ → 앱 → 이 사이트를 앱으로 설치</b> → <b>설치</b>.</li>
      <li>시작 메뉴나 작업 표시줄의 <b>제삶</b> 아이콘으로 엽니다. (작업 표시줄에 고정하면 편합니다)</li>
    </ol>` }
];
function renderInstall() {
  const d = device();
  $('#inst-dev').textContent = `지금 기기: ${d.label}`;
  const ios = d.os === 'iphone' || d.os === 'ipad';
  $('#inst-now').innerHTML = d.app ? '<p class="inst-ok">✓ 이미 앱으로 설치해서 열고 있습니다.</p>'
    : installEvt ? '<button type="button" class="primary big" id="inst-go">지금 설치하기</button>'
    : (ios && d.br !== 'Safari' ? '<p class="tts-tip">아이폰·아이패드는 <b>Safari</b>에서 설치하는 것이 가장 확실합니다. 이 주소를 Safari로 열어 주세요.</p>' : '');
  $('#inst-guide').innerHTML = INSTALL_GUIDE.map(g => `<details ${g.os.includes(d.os) ? 'open' : ''}><summary>${g.title}${g.os.includes(d.os) ? ' <span class="here">지금 기기</span>' : ''}</summary>${g.html}</details>`).join('');
}
document.addEventListener('click', e => { if (e.target.closest('[data-install]')) { renderInstall(); $('#inst').hidden = false; } });
$('#inst').addEventListener('click', async e => {
  if (e.target.id === 'inst' || e.target.closest('#inst-close')) { $('#inst').hidden = true; return; }
  if (e.target.closest('#inst-go') && installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); installEvt = null; if (r && r.outcome !== 'accepted') renderInstall(); }
});

/* ---------------- 번역 보기 (영어·일본어·아랍어) ----------------
 * 번역은 과마다 언어별 문서(lessons/{과}/tr/{언어})에 { t: { 블록ID: [문장별 번역…] } } 로 저장.
 * 문장 나누기는 build 쪽(trlib.py)과 같은 규칙 → 문장 수가 맞으면 '문장마다', 아니면 그 블록만 '문단 아래'로 보여 줌. */
const TRL = {
  en: { ko: '영어', name: 'English', tag: 'EN', dir: 'ltr' },
  ja: { ko: '일본어', name: '日本語', tag: 'JA', dir: 'ltr' },
  ar: { ko: '아랍어', name: 'العربية', tag: 'AR', dir: 'rtl' }
};
const TR_PUNCT = '.?!…', TR_CLOSE = '"”’\')]」』';
function splitSent(s) {
  const out = []; let i = 0, start = 0; const n = s.length;
  while (i < n) {
    if (TR_PUNCT.includes(s[i])) {
      let j = i; while (j < n && TR_PUNCT.includes(s[j])) j++; while (j < n && TR_CLOSE.includes(s[j])) j++;
      if (j >= n || /\s/.test(s[j])) { while (j < n && /\s/.test(s[j])) j++; out.push(s.slice(start, j)); start = j; i = j; continue; }
      i = j; continue;
    }
    i++;
  }
  if (start < n) out.push(s.slice(start));
  const m = [];
  out.forEach(seg => { if (m.length && (m[m.length - 1].trim().length <= 3 || /^[(\[]?\d+[.)]\s*$/.test(m[m.length - 1]))) m[m.length - 1] += seg; else m.push(seg); });
  if (m.length > 1 && m[m.length - 1].trim().length <= 3) m[m.length - 2] += m.pop();
  return m;
}
const trCache = {};
const trLangsOf = () => (curBook().langs || []).filter(l => TRL[l]);
const trOn = () => !!Store.pref('trOn', false) && trActive().length > 0;
const trActive = () => { const have = trLangsOf(); return (Store.pref('trLangs', ['en']) || []).filter(l => have.includes(l)); };
async function trLoad(lid, lang) {
  const k = lid + '/' + lang; if (k in trCache) return trCache[k];
  try { const o = await B.getTr(lid, lang); trCache[k] = o && o.t ? o.t : null; } catch (e) { console.warn('tr', e); trCache[k] = null; }
  return trCache[k];
}
function trJoin(lang, arr) { return arr.map(x => String(x).trim()).filter(Boolean).join(lang === 'ja' ? '' : ' '); }
function trClear(root) {
  $$('.trb, .se', root).forEach(x => x.remove());
  $$('.trrow', root).forEach(row => { while (row.firstChild) row.parentNode.insertBefore(row.firstChild, row); row.remove(); });
  root.classList.remove('tr-side');
}
let trSeq = 0;
async function applyTr() {
  const r = $('#reader'); if (!r) return; const my = ++trSeq;
  const btn = $('#btn-tr'); const have = trLangsOf();
  btn.hidden = !have.length; btn.setAttribute('aria-pressed', trOn() ? 'true' : 'false');
  $('#btn-tr .n').textContent = trOn() ? trActive().length : '';
  trClear(r);
  if (!trOn() || !cur()) return;
  const langs = trActive(); const lid = st.lid;
  const data = await Promise.all(langs.map(l => trLoad(lid, l)));
  if (my !== trSeq || lid !== st.lid) return;
  const pick = Store.pref('trMode', 'auto');
  const mode = pick === 'auto' ? (r.clientWidth >= 560 + 220 * langs.length ? 'side' : 'para') : pick;
  const admin = isAdmin() && B.kind === 'firebase';
  const items = [...$$('#reader .blk[data-id]'), ...$$('#reader .hero [data-trid]')];
  items.forEach(el => {
    const id = el.dataset.id || el.dataset.trid; if (!id) return;
    const per = langs.map((l, i) => [l, data[i] && data[i][id]]).filter(([, a]) => a && a.length);
    if (!per.length) return;
    const tx = el.dataset.id && $('.tx', el);
    if (mode === 'sent' && tx) {
      const parts = splitSent(tx.textContent);
      if (per.every(([, a]) => a.length === parts.length)) { trSentences(tx, parts, per); return; }
    }
    const box = document.createElement('div'); box.className = 'trb'; box.dataset.for = id;
    box.innerHTML = per.map(([l, a]) => `<p class="tl tl-${l}" lang="${l}" dir="${TRL[l].dir}"><b class="tg" data-l="${l}">${TRL[l].tag}</b>${a.map((x, k) => `<span class="ts" data-i="${k}" data-k="${k}" data-b="${id}">${esc(String(x).trim())}</span>`).join(l === 'ja' ? '' : ' ')}</p>`).join('') +
      (admin ? `<button type="button" class="tr-edit" data-tr-edit="${id}" aria-label="번역 고치기">✎</button>` : '');
    el.after(box);
    if (mode === 'side' && el.dataset.id) {
      const row = document.createElement('div'); row.className = 'trrow'; row.style.setProperty('--trn', per.length);
      el.before(row); row.append(el, box);
    }
  });
  r.classList.toggle('tr-side', mode === 'side');
  r.classList.toggle('tr-tap', trTap());
  applyMarks();   // 번역에 칠한 형광펜·메모 다시 그리기
}
function trSentences(tx, parts, per) {
  // 문장 끝마다 빈 표시(span)를 끼우고, 번역은 CSS ::after 로 보여 줌 → 본문 글자(형광펜 위치)는 그대로
  const ends = []; let acc = 0; parts.forEach(p => { acc += p.length; ends.push(acc); });
  for (let k = ends.length - 1; k >= 0; k--) {          // 뒤에서부터 넣어야 앞쪽 위치가 안 바뀜
    let pos = 0, hit = null;
    for (const node of koNodes(tx)) { const len = node.length; if (ends[k] <= pos + len) { hit = { node, off: ends[k] - pos }; break; } pos += len; }
    if (!hit) continue;
    const frag = document.createDocumentFragment();
    per.forEach(([l, a]) => { const sp = document.createElement('span'); sp.className = `se tl-${l}`; sp.textContent = String(a[k]).trim(); sp.dataset.k = k; sp.dataset.b = tx.closest('[data-id]').dataset.id; sp.setAttribute('lang', l); sp.dir = TRL[l].dir; frag.append(sp); });
    if (hit.off < hit.node.length) hit.node.splitText(hit.off).before(frag);
    else { let t = hit.node; while (t.parentNode !== tx && !t.nextSibling && t.parentNode) t = t.parentNode; t.after(frag); }
  }
}
/* ---- 번역 누르면 원어민 목소리로 읽기 (형광펜·메모와 따로) ---- */
const trTap = () => Store.pref('trTap', true) !== false;
let sayEl = null;
function sayStop() { stopSay(); $$('.tr-say').forEach(x => x.classList.remove('tr-say')); sayEl = null; }
function sayTr(el, parts, lang, partEls) {
  if (sayEl === el) { sayStop(); return; }          // 읽는 중에 다시 누르면 멈춤
  sayStop(); sayEl = el;
  const hit = k => { $$('.tr-say').forEach(x => x.classList.remove('tr-say')); const t = partEls ? partEls[k] : el; if (t) t.classList.add('tr-say'); };
  const r = say(parts, lang, { rate: Store.pref('ttsRate', 1), onPart: hit, onDone: e => { if (sayEl === el) sayStop(); if (e && e.error && e.error !== 'interrupted') toast('읽지 못했습니다: ' + e.error); } });
  if (!r) { sayStop(); toast('이 브라우저는 음성 듣기를 지원하지 않습니다'); return; }
  if (!r.voice && !Store.pref('nv_' + lang, false)) { Store.setPref('nv_' + lang, true); toast(`이 기기에 ${VLANG[lang].ko} 목소리가 없어 기본 목소리로 읽습니다 · 번역 설정의 ‘목소리 고르기’에서 설치 안내`); }
}
$('#reader').addEventListener('click', e => {
  if (!trTap() || !getSelection().isCollapsed) return;
  const t = e.target;
  const se = t.closest('.se'); const mk = t.closest('mark.hl');
  if (mk && (!se || se.contains(mk))) return;          // 칠한 곳을 누르면 메모 (소리 X)
  if (se) { const l = (se.className.match(/tl-(\w+)/) || [])[1]; if (l) sayTr(se, [se.textContent], l); return; }
  const ts = t.closest('.trb .ts'); if (ts) { const l = ts.closest('.tl').lang; sayTr(ts, [ts.textContent], l); return; }
  const tg = t.closest('.trb .tg[data-l]'); if (tg) { const p = tg.closest('.tl'); const parts = $$('.ts', p); sayTr(p, parts.map(x => x.textContent), tg.dataset.l, parts); }
});
function voiceInfo() {
  const have = trLangsOf(); if (!have.length || !('speechSynthesis' in window)) return have.length ? '이 브라우저는 소리로 읽기를 지원하지 않습니다.' : '';
  return '이 기기 목소리: ' + have.map(l => { const v = pickVoice(l); return `${TRL[l].ko} ${v ? '✓ <small>' + esc(voiceLabel(v)) + '</small>' : '<b class="no">없음</b>'}`; }).join(' · ');
}
/* 번역 설정 창 */
function renderTrModal() {
  const have = trLangsOf(); const act = Store.pref('trLangs', ['en']) || [];
  $('#trm-on').checked = !!Store.pref('trOn', false);
  $('#trm-langs').innerHTML = have.map(l => { const i = act.indexOf(l); return `<label class="trm-l"><input type="checkbox" data-l="${l}" ${i >= 0 ? 'checked' : ''}>
    <span class="trm-n"><b>${TRL[l].ko} <span class="tl-${l}" lang="${l}">${TRL[l].name}</span></b><small>${{ en: '성경 인용: BSB', ja: '성경 인용: 구어역(口語訳)', ar: '표준 아랍어(푸스하) · 이집트·레바논·요르단·사우디 공통 · 성경: 반다이크역' }[l]}</small></span>
    <span class="trm-o">${i >= 0 ? i + 1 : ''}</span></label>`; }).join('') || '<p class="muted">이 교재에는 아직 번역이 없습니다.</p>';
  const m = Store.pref('trMode', 'auto'); $$('#trm-mode button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
  $('#trm-tap').checked = trTap();
  const hasAr = have.includes('ar'); const c = arCountry();
  $('#trm-arc').hidden = !hasAr;
  $('#trm-arc').innerHTML = hasAr ? `<span class="muted small">아랍어 목소리 나라 <small>(글은 표준 아랍어 하나, 억양만 바뀜)</small></span><div class="chips-row">${AR_C.map(([k, n]) => `<button type="button" data-arc="${k}" class="${k === c ? 'on' : ''} ${arHas(k) ? '' : 'no'}">${n}${k !== 'auto' && !arHas(k) ? ' <small>없음</small>' : ''}</button>`).join('')}</div>` : '';
  $('#trm-vinfo').innerHTML = voiceInfo();
}
if ('speechSynthesis' in window) speechSynthesis.addEventListener && speechSynthesis.addEventListener('voiceschanged', () => { if (!$('#trm').hidden) renderTrModal(); });
$('#btn-tr').addEventListener('click', () => { renderTrModal(); $('#trm').hidden = false; });
$('#trm').addEventListener('click', e => {
  if (e.target.id === 'trm' || e.target.closest('#trm-close')) { $('#trm').hidden = true; return; }
  const mb = e.target.closest('#trm-mode [data-m]'); if (mb) { Store.setPref('trMode', mb.dataset.m); renderTrModal(); applyTr(); }
  const ac = e.target.closest('#trm-arc [data-arc]'); if (ac) { setArCountry(ac.dataset.arc); renderTrModal(); if (tts) tts.refreshLangs();
    const n = AR_C.find(x => x[0] === ac.dataset.arc)[1];
    if (ac.dataset.arc !== 'auto' && !arHas(ac.dataset.arc)) toast(`이 기기에는 ${n} 목소리가 없어 있는 아랍어 목소리로 읽습니다`);
    else say([VLANG.ar.demo], 'ar', { rate: Store.pref('ttsRate', 1) }); }
  if (e.target.closest('#trm-voices')) { $('#trm').hidden = true; if (tts) tts.openModal(trActive()[0] || trLangsOf()[0] || 'ko'); }
});
$('#trm').addEventListener('change', e => {
  if (e.target.id === 'trm-tap') { Store.setPref('trTap', e.target.checked); if (!e.target.checked) sayStop(); renderTrModal(); applyTr(); return; }
  if (e.target.id === 'trm-on') { Store.setPref('trOn', e.target.checked); if (e.target.checked && !trActive().length) Store.setPref('trLangs', trLangsOf().slice(0, 1)); }
  const l = e.target.dataset.l;
  if (l) { let act = (Store.pref('trLangs', ['en']) || []).filter(x => x !== l); if (e.target.checked) act.push(l); Store.setPref('trLangs', act); if (act.length) Store.setPref('trOn', true); }
  renderTrModal(); applyTr();
});
let trResizeT; addEventListener('resize', () => { if (Store.pref('trMode', 'auto') === 'auto' && trOn()) { clearTimeout(trResizeT); trResizeT = setTimeout(applyTr, 300); } });
/* 관리자: 번역 고치기 */
let trEditId = null;
$('#reader').addEventListener('click', e => {
  const b = e.target.closest('[data-tr-edit]'); if (!b) return;
  trEditId = b.dataset.trEdit; const L = cur();
  const blk = L.units.flatMap(u => u.blocks).find(x => x.id === trEditId);
  const ko = blk ? splitSent(blockText(blk) || plain(blk.text || '')) : [];
  $('#tre-body').innerHTML = trActive().map(l => { const a = (trCache[st.lid + '/' + l] || {})[trEditId] || [];
    return `<fieldset class="tre-l"><legend>${TRL[l].ko}</legend>${a.map((t, i) => `<label><small>${esc((ko[i] || '').trim())}</small><textarea data-l="${l}" data-i="${i}" dir="${TRL[l].dir}" rows="2">${esc(t)}</textarea></label>`).join('')}</fieldset>`; }).join('');
  $('#tre').hidden = false;
});
$('#tre').addEventListener('click', async e => {
  if (e.target.id === 'tre' || e.target.closest('#tre-cancel')) { $('#tre').hidden = true; return; }
  if (!e.target.closest('#tre-save')) return;
  const btn = $('#tre-save'); btn.disabled = true;
  try {
    const changed = new Set();
    $$('#tre-body textarea').forEach(ta => { const l = ta.dataset.l, i = +ta.dataset.i; const t = trCache[st.lid + '/' + l]; if (t && t[trEditId] && t[trEditId][i] !== ta.value) { t[trEditId][i] = ta.value; changed.add(l); } });
    for (const l of changed) await B.putTr(st.lid, l, { lid: st.lid, lang: l, book: st.book, t: trCache[st.lid + '/' + l] }, curBook().access || 'all');
    $('#tre').hidden = true; applyTr(); toast(changed.size ? '번역을 고쳤습니다' : '바뀐 것이 없습니다');
  } catch (err) { toast('저장하지 못했습니다: ' + (err.code || err.message)); }
  finally { btn.disabled = false; }
});
/* ---------------- 음성 듣기 ---------------- */
function setupTTS() {
  if (tts) return;
  const readable = el => el.querySelector('.tx') && !el.closest('.unit-extra');
  tts = initTTS({
    toast,
    getRate: () => Store.pref('ttsRate', 1),
    setRate: v => Store.setPref('ttsRate', v),
    where: el => { const sec = el.closest('.unit'); const L = cur(); const u = L && sec && L.units.find(x => x.id === sec.id); return (L && lessonNo(L) ? L.no + '과 · ' : '') + (u ? plain(u.title) : ''); },
    // 어디서부터 읽을지: 고른 글자가 있으면 그 문단, 없으면 지금 화면 맨 위 문단
    getStart(auto) {
      const all = $$('#reader .blk').filter(readable); if (!all.length) return null;
      if (auto) return all[0];
      const sel = getSelection(); if (sel.rangeCount && !sel.isCollapsed) { const n = sel.anchorNode; const b = n && (n.nodeType === 1 ? n : n.parentElement).closest('#reader .blk'); if (b && readable(b)) { sel.removeAllRanges(); return b; } }
      const top = isMob() ? 110 : $('#reader').getBoundingClientRect().top + 10;
      return all.find(b => b.getBoundingClientRect().bottom > top) || all[0];
    },
    getBlocks(start) { const all = $$('#reader .blk').filter(readable); const i = Math.max(0, all.indexOf(start)); return all.slice(i); },
    // 번역 언어로 듣기
    trLangs: () => trLangsOf(),
    prepTr: l => trLoad(st.lid, l),
    trChunks(el, l) {
      const a = (trCache[st.lid + '/' + l] || {})[el.dataset.id]; if (!a || !a.length) return [];
      const tx = $('.tx', el); const parts = tx ? splitSent(koText(tx)) : [];
      const offs = []; let acc = 0; parts.forEach(p => { offs.push([acc, acc + p.trimEnd().length]); acc += p.length; });
      const same = parts.length === a.length;
      return a.map((s, i) => ({ id: el.dataset.id, i, lang: l, say: String(s).trim(), s: same ? offs[i][0] : 0, e: same ? offs[i][1] : 0 })).filter(c => c.say);
    },
    markTr(c) {
      const el = $(`#reader .blk[data-id="${c.id}"]`); if (!el) return null;
      return $$(`.se.tl-${c.lang}`, el)[c.i] || $(`#reader .trb[data-for="${c.id}"] .tl-${c.lang} .ts[data-i="${c.i}"]`);
    },
    // 폰: 한 단원을 다 읽으면 다음 단원으로 넘어가서 계속 읽음
    async onEnd() {
      const L = cur(); if (!L || !isMob() || st.ui >= L.body.length - 1) return false;
      goUnit(st.ui + 1); toast('다음 단원: ' + plain(L.body[st.ui].title)); return true;
    }
  });
}

/* ---------------- 시작: 로그인 → 권한 확인 → 교재 ---------------- */
const firstReady = () => { if (!st.index) return null; const x = st.index.lessons.find(l => l.ready && l.no >= 1) || st.index.lessons.find(l => l.ready); return x ? x.id : null; };
function gate(state, info = {}) {
  const g = $('#gate'); g.hidden = state === 'none';
  $$('[data-g]', g).forEach(x => x.hidden = x.dataset.g !== state);
  if (state === 'nomember') { $('#g-name').textContent = info.name || ''; $('#g-uid').textContent = info.uid || ''; $('#g-email').textContent = info.email || ''; $('#g-why').textContent = info.reason === 'stopped' ? '사용이 중지된 계정입니다.' : '아직 등록되지 않았습니다.'; }
  if (state === 'error') $('#g-err').textContent = info.msg || '';
}
$('#btn-login').addEventListener('click', async () => {
  $('#btn-login').disabled = true;
  try { await B.signIn(); } catch (e) { toast(e.code === 'auth/unauthorized-domain' ? '이 주소가 Firebase 승인된 도메인에 없습니다' : '로그인하지 못했습니다: ' + (e.code || e.message)); }
  finally { $('#btn-login').disabled = false; }
});
$('#btn-copy-uid').addEventListener('click', () => {
  const t = $('#g-email').textContent || $('#g-uid').textContent;
  (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => toast('UID를 복사했습니다'), () => { const r = document.createRange(); r.selectNodeContents($('#g-uid')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('선택된 UID를 복사하세요'); });
});
[$('#btn-logout'), $('#btn-logout2')].forEach(b => b.addEventListener('click', async () => { await B.signOut(); location.reload(); }));

async function enterApp(info) {
  gate('loading');
  await Store.load();
  B.watchUser(onLive);
  setFs(Store.pref('fs', 17)); setPenColor(Store.pref('pen', 'y'));
  $('#acct-name').textContent = info.name + (info.role === 'admin' ? ' · 관리자' : info.role === 'teacher' ? ' · 강사' : '');
  $('#btn-admin').hidden = !(info.role === 'admin' && B.kind === 'firebase');
  $('#btn-people').hidden = info.role !== 'admin';
  $('#btn-admm').hidden = info.role !== 'admin';
  document.body.dataset.role = info.role || 'member'; st.me = info;
  $('#btn-logout').hidden = B.kind !== 'firebase';
  setupTTS();
  await loadLibrary();
  await loadBooks().catch(() => {});
  st.index = await loadBookIndex('jeja');
  gate('none');
  const anyBook = st.library.some(b => b.id !== 'jeja' && canSee(b));
  if ((!st.index || !firstReady()) && !anyBook) {
    $('#reader').innerHTML = `<div class="page-wrap"><h2>교재 데이터가 아직 없습니다</h2><p>${info.role === 'admin' ? '받은 <b>교재데이터</b> 폴더를 [교재 올리기]에서 올려 주세요.' : '관리자가 교재를 올리면 여기에 표시됩니다.'}</p></div>`;
    if (info.role === 'admin' && B.kind === 'firebase') openUploader();
    return;
  }
  // 주소 끝에 과 주소(#S01-U02 등)가 있으면 그 교재·과로, 아니면 서재부터
  const h = location.hash.slice(1); const m = h.match(/^([A-Z]\d\d)-U/);
  const hb = m && bookOfLid(m[1]);
  if (hb && canSee(hb)) {
    const ix = await loadBookIndex(hb.id);
    if (ix && ix.lessons.some(l => l.id === m[1] && l.ready)) { const L = await loadLesson(m[1]); await openBook(hb.id, m[1], Math.max(0, L.body.findIndex(u => u.id === h))); }
    else await showLibrary();
  } else await showLibrary();
  // 관리자: 공개 설정이 없던 예전 자료를 '전체 공개'로 한 번 정리 (이 기기에서 한 번만)
  if (info.role === 'admin' && B.kind === 'firebase') {
    let doneKey = null; try { doneKey = localStorage.getItem('jesam.attvis.v1'); } catch (e) {}
    if (!doneKey && st.indexes.jeja) B.migrateAttVis(st.indexes.jeja.lessons.map(l => l.id)).then(n => { try { localStorage.setItem('jesam.attvis.v1', String(Date.now())); } catch (e) {} if (n) { toast(`예전 자료 ${n}개를 🌐 전체 공개로 정리했습니다`); syncNow(true); } }).catch(e => console.warn('migrate', e));
  }
}

(async function start() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  gate('loading');
  B = await createBackend();
  let entered = false;
  B.onAuth(info => {
    if (info.state === 'out') { gate('out'); return; }
    if (info.state === 'nomember') { gate('nomember', info); return; }
    if (entered) return; entered = true;
    enterApp(info).catch(err => { console.error(err); gate('error', { msg: '교재를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요. (' + (err.code || err.message) + ')' }); });
  });
})().catch(err => gate('error', { msg: '앱을 시작하지 못했습니다: ' + err.message }));
})();
