/* 제자의 삶 디지털 교재 — 앱 (vanilla JS, ES module)
 * 교재 본문·원본 사진·내 표시·자료는 backend.js를 통해 Firestore에 저장됩니다.
 * (주소 끝에 ?local 을 붙이면 data/ 폴더와 이 기기 저장소로 시험 실행)
 */
import { createBackend } from './backend.js';
import { editImage } from './imgedit.js';
import { initBible, openRef as bibleOpen, linkRefs, loadBooks } from './bible.js';
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
const pageLabel = p => /^i\d/.test(p) ? `안내 ${p.slice(1)}쪽` : `${p}쪽`;
const lessonNo = L => (L.no >= 1 && L.no <= 12) ? String(L.no) : '';
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 1800); }

const st = { index: null, lessons: {}, lid: null, ui: 0, pg: null, scope: 'all', visibleUnit: null };

/* ---------------- 데이터 ---------------- */
async function loadIndex() { st.index = await B.getIndex(); return st.index; }
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
      `<li><button type="button" data-unit="${i}" class="${(isMob() ? i === st.ui : u.id === st.visibleUnit) ? 'on' : ''} ${done[u.id] ? 'done' : ''}">${esc(u.title)}</button></li>`).join('')}</ol>` : '';
    return `<li class="${x.ready ? '' : 'off'} ${on ? 'cur' : ''}"><button type="button" data-lesson="${x.id}" ${x.ready ? '' : 'aria-disabled="true"'}>
      <span class="no">${lessonNo(x)}</span><span>${esc(x.title)}</span>
      <span class="pg">${x.ready ? (/^i/.test(x.pageFrom) ? '' : x.pageFrom + '쪽') : '준비 중'}</span></button>${units}</li>`;
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
  const no = lessonNo(L);
  const title = no ? L.title : plain(h1 ? h1.text : L.title);
  return `<header class="hero" data-page="${L.cover.blocks[0].page}">${no ? `<div class="no" aria-hidden="true">${no}</div>` : `<div class="muted" style="font-size:13px">${esc(L.title)}</div>`}
    <h1>${esc(title)}</h1>${epi ? `<p class="epi">${inline(epi.text)}</p>` : ''}${cite ? `<p class="epi-cite">${esc(cite.text)}</p>` : ''}</header>`;
}
function extraHTML(u) {
  const list = Store.atts().filter(a => a.uid === u.id);
  return `<div class="unit-extra" data-uid="${u.id}"><div class="ue-h">추가 자료 ${list.length ? list.length : ''}<button type="button" class="add" data-add="${u.id}">+ 자료 추가</button></div>${list.map(attHTML).join('')}</div>`;
}
function attHTML(a) {
  const del = `<button type="button" class="del" data-del-att="${a.id}">삭제</button>`;
  if (a.kind === 'link') return `<div class="supp"><div class="st">🔗 ${esc(a.title)}${del}</div><p><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.url)}</a></p></div>`;
  if (a.kind === 'image') return `<div class="supp"><div class="st">🖼 ${esc(a.title)}${del}</div><img src="${esc(a.img || '')}" alt="${esc(a.title)}"></div>`;
  return `<div class="supp"><div class="st">📝 ${esc(a.title)}${del}</div><p>${esc(a.text || '')}</p></div>`;
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
  $('#top-lesson').textContent = (lessonNo(L) ? L.no + '과 ' : '') + L.title;
  applyMarks(); hydrateImages(r); observeBlocks();
  const chip = $('.chips .on', r); if (chip) chip.scrollIntoView({ inline: 'center', block: 'nearest' });
}
const short = t => { const s = plain(t).replace(/[.?!]$/, ''); return s.length > 13 ? s.slice(0, 12) + '…' : s; };

async function openLesson(lid, ui = 0, blockId = null, q = null) {
  const L = await loadLesson(lid);
  if (!Store.hasAtts(lid)) await Store.loadAtts(lid);
  watchLessonAtts(lid);
  const changed = st.lid !== lid; st.lid = lid;
  if (blockId) ui = Math.max(0, L.body.indexOf(L.units[L.blockUnit[blockId]]));
  st.ui = Math.min(Math.max(ui, 0), L.body.length - 1);
  renderReader(); renderToc(); renderNotes(); renderFiles();
  if (changed || !st.pg) showPage(L.pages[0], true);
  Store.setPref('pos', { lid, ui: st.ui });
  history.replaceState(null, '', '#' + L.body[st.ui].id);
  if (blockId) jumpTo(blockId, q);
  else if (isMob()) window.scrollTo(0, 0);
  else if (ui > 0) $('#' + L.body[st.ui].id).scrollIntoView({ block: 'start' });
  else $('#reader').scrollTop = 0;
}
function goUnit(i) {
  const L = cur(); if (!L) return;
  if (isMob()) { st.ui = Math.min(Math.max(i, 0), L.body.length - 1); renderReader(); renderToc(); window.scrollTo(0, 0); Store.setPref('pos', { lid: st.lid, ui: st.ui }); history.replaceState(null, '', '#' + L.body[st.ui].id); }
  else { const el = $('#' + L.body[i].id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
}
function jumpTo(blockId, q) {
  const el = $(`#reader [data-id="${blockId}"]`); if (!el) return;
  if (q) { const tx = $('.tx', el); if (tx) wrapFind(tx, q); }
  el.scrollIntoView({ block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}
function wrapFind(tx, q) {
  const w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
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
function segmentsFromSelection() {
  const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return null;
  const R = sel.getRangeAt(0); const reader = $('#reader');
  if (!reader.contains(R.commonAncestorContainer)) return null;
  const segs = [];
  $$('.tx', reader).forEach(tx => {
    if (!R.intersectsNode(tx)) return;
    const len = tx.textContent.length;
    const s = tx.contains(R.startContainer) ? offsetIn(tx, R.startContainer, R.startOffset) : 0;
    const e = tx.contains(R.endContainer) ? offsetIn(tx, R.endContainer, R.endOffset) : len;
    if (e > s && tx.textContent.slice(s, e).trim()) segs.push({ block: tx.closest('[data-id]').dataset.id, s, e, quote: tx.textContent.slice(s, e) });
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
const inText = n => { const el = n && (n.nodeType === 1 ? n : n.parentElement); return el && el.closest('#reader .tx'); };
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
  Store.addMarks(selSegs.map((s, i) => ({ id: gid + '-' + i, gid, lid: st.lid, block: s.block, s: s.s, e: s.e, c, note: i === 0 ? (note || '') : '', quote: s.quote, at })));
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
  const q = $('.np-quote', pop); q.textContent = quote.length > 90 ? quote.slice(0, 90) + '…' : quote; q.className = 'np-quote c-' + segs[0].c;
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

function unwrapAll(root) { $$('mark.hl', root).forEach(m => { const p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); m.remove(); p.normalize(); }); }
function wrapOffsets(tx, s, e, cls, gid, title) {
  const w = document.createTreeWalker(tx, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
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
    const tx = $(`[data-id="${m.block}"] .tx`, r); if (!tx) return;
    wrapOffsets(tx, m.s, m.e, `hl c-${m.c}${notes[m.gid] ? ' has-note' : ''}`, m.gid, notes[m.gid]);
  });
  new Set([...Object.keys(notes), ...Object.keys(photos)]).forEach(g => { const ms = $$(`mark.hl[data-gid="${g}"]`, r); if (ms.length) { const last = ms[ms.length - 1]; last.classList.add('note-end'); if (photos[g]) last.classList.add('has-photo'); } });
}

/* ---------------- 내 노트 ---------------- */
function renderNotes() {
  const groups = {}; Store.marks().forEach(m => { (groups[m.gid] = groups[m.gid] || []).push(m); });
  const items = Object.values(groups).map(g => ({ kind: 'mark', lid: g[0].lid, block: g[0].block, c: g[0].c, quote: g.map(x => x.quote).join(' … '), note: g[0].note, ph: (g[0].photos || []).length, at: g[0].at }));
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
      : `<button type="button" class="note" data-jump="${i.block}" data-lid="${lid}"><q class="c-${i.c}">${esc(i.quote.length > 70 ? i.quote.slice(0, 70) + '…' : i.quote)}</q>${i.note ? esc(i.note) : ''}${i.ph ? ` <span class="kind">📷 ${i.ph}</span>` : ''}</button>`).join('');
  }).join('')}</div>`;
}
$('#notes').addEventListener('click', e => { const b = e.target.closest('[data-jump]'); if (!b) return; closeSheets(); openLesson(b.dataset.lid, 0, b.dataset.jump); });

/* ---------------- 자료(첨부) ---------------- */
function renderFiles() {
  const L = cur(); if (!L) return; const f = $('#files');
  const list = Store.atts().filter(a => a.lid === L.id);
  f.innerHTML = `<p class="empty">과·단원마다 보충 설명, 링크(영상·찬양), 사진을 붙일 수 있습니다. 붙인 자료는 본문 해당 단원 끝에도 표시됩니다.</p>` +
    L.body.map(u => { const ul = list.filter(a => a.uid === u.id); return `<div class="ngroup">${esc(u.title)}</div>${ul.map(attHTML).join('')}<button type="button" class="note" data-add="${u.id}" style="color:var(--brand)">+ 이 단원에 자료 추가</button>`; }).join('');
  hydrateImages(f);
}
$('#files').addEventListener('click', e => {
  const a = e.target.closest('[data-add]'); if (a) { openAttModal(a.dataset.add); return; }
  const d = e.target.closest('[data-del-att]'); if (d) { Store.removeAtt(d.dataset.delAtt).then(refreshAtts, er => toast('삭제하지 못했습니다: ' + er.message)); }
  const img = e.target.closest('.supp img'); if (img && img.src) { const lb = $('#lightbox'); $('img', lb).src = img.src; lb.hidden = false; }
});
function refreshAtts() { $$('#reader .unit-extra').forEach(x => { const u = cur().units.find(u => u.id === x.dataset.uid); const t = document.createElement('div'); t.innerHTML = extraHTML(u); x.replaceWith(t.firstElementChild); }); hydrateImages($('#reader')); renderFiles(); }

let attKind = 'note', attUid = null;
function openAttModal(uid) {
  attUid = uid; const L = cur(); const u = L.units.find(x => x.id === uid);
  $('#att-target').textContent = `${lessonNo(L) ? L.no + '과 · ' : ''}${plain(u.title)}`;
  $('#att-form').reset(); setKind('note'); $('#modal').hidden = false; $('#att-title').focus();
}
function setKind(k) { attKind = k; $$('#att-kind button').forEach(b => b.classList.toggle('on', b.dataset.k === k)); $$('#att-form [data-for]').forEach(l => l.hidden = l.dataset.for !== k); }
$('#att-kind').addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) setKind(b.dataset.k); });
$('#att-cancel').addEventListener('click', () => $('#modal').hidden = true);
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });
$('#att-form').addEventListener('submit', async e => {
  e.preventDefault();
  const a = { id: uidGen('a'), lid: st.lid, uid: attUid, kind: attKind, title: $('#att-title').value.trim(), at: Date.now() };
  if (attKind === 'note') a.text = $('#att-text').value.trim();
  if (attKind === 'link') { a.url = $('#att-url').value.trim(); if (!/^https?:\/\//.test(a.url)) { toast('https:// 로 시작하는 주소를 넣어 주세요'); return; } }
  if (attKind === 'image') {
    const file = $('#att-file').files[0]; if (!file) { toast('사진 파일을 골라 주세요'); return; }
    const r = await editImage(file).catch(() => null); if (!r) { toast('사진 넣기를 취소했습니다'); return; } a.img = r.dataUrl;
  }
  const btn = $('#att-form .primary'); btn.disabled = true;
  try { await Store.addAtt(a); $('#modal').hidden = true; refreshAtts(); toast('자료를 추가했습니다'); }
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
  const ready = st.index.lessons.filter(l => l.ready);
  await Promise.all(ready.map(l => loadLesson(l.id)));
  const out = [];
  const snip = (t, i) => { const s = Math.max(0, i - 20); return (s ? '…' : '') + t.slice(s, i + q.length + 30) + (i + q.length + 30 < t.length ? '…' : ''); };
  const hl = s => esc(s).split(esc(q)).join(`<mark>${esc(q)}</mark>`);
  if (st.scope === 'mine') {
    const g = {}; Store.marks().forEach(m => { const k = m.gid; g[k] = g[k] || m; });
    Object.values(g).forEach(m => { const t = (m.note || '') + ' ' + m.quote; const i = t.indexOf(q); if (i >= 0) out.push({ lid: m.lid, block: m.block, label: '내 메모', text: snip(t, i) }); });
    Object.entries(Store.answers()).forEach(([id, a]) => { const i = a.t.indexOf(q); if (i >= 0) out.push({ lid: id.slice(0, 3), block: id, label: '내 답', text: snip(a.t, i) }); });
    Store.atts().forEach(a => { const t = a.title + ' ' + (a.text || '') + ' ' + (a.url || ''); const i = t.indexOf(q); if (i >= 0) out.push({ lid: a.lid, block: (st.lessons[a.lid].units.find(u => u.id === a.uid) || { blocks: [{}] }).blocks[0].id, label: '추가 자료', text: snip(t, i) }); });
  } else {
    ready.filter(l => st.scope === 'all' || l.id === st.lid).forEach(l => {
      const L = st.lessons[l.id];
      L.units.forEach(u => u.blocks.forEach(b => {
        const t = plain((b.ref ? '[' + b.ref + '] ' : '') + (b.text || '') + (b.rows ? b.rows.flat().join(' ') : ''));
        const i = t.indexOf(q); if (i < 0) return;
        out.push({ lid: l.id, block: b.id, label: `${lessonNo(L) ? L.no + '과' : L.title} · ${u.title === '표지' ? '표지' : plain(u.title)} · ${pageLabel(b.page)}`, text: snip(t, i), q });
      }));
    });
  }
  toc.hidden = true; res.hidden = false;
  res.innerHTML = `<p class="res-count">「${esc(q)}」 ${out.length}건 · 현재 텍스트화된 과만 검색됩니다</p>` +
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideBar(); closeNote(); $('#modal').hidden = true; $('#lightbox').hidden = true; } });

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
  if (n === 'index.json') return { kind: 'index', label: '목차', order: 3 };
  let m = n.match(/^(L\d\d)\.json$/); if (m) return { kind: 'lesson', lid: m[1], label: '본문 ' + m[1], order: 2 };
  m = n.match(/^p(.+)\.webp$/); if (m) return { kind: 'page', page: m[1], label: '원본 ' + pageLabel(m[1]), order: 1 };
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
  const n = { index: 0, lesson: 0, page: 0 }; uplItems.forEach(x => n[x.kind]++);
  $('#upl-sum').textContent = uplItems.length ? `목차 ${n.index} · 본문 ${n.lesson}과 · 원본 사진 ${n.page}쪽` : '아직 고른 파일이 없습니다';
  $('#upl-list').innerHTML = uplItems.map(x => `<li><span>${esc(x.label)}</span><small>${esc(x.file.name)}</small><b class="${x.status === '완료' ? 'ok' : x.status.startsWith('실패') ? 'bad' : ''}">${esc(x.status)}</b></li>`).join('');
  $('#upl-go').disabled = !uplItems.length || uplItems.every(x => x.status === '완료');
}
const readText = f => f.text();
const readDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
async function runUpload() {
  $('#upl-go').disabled = true;
  const lessonsIn = {};
  for (const x of uplItems.filter(x => x.kind === 'lesson')) { try { lessonsIn[x.lid] = JSON.parse(await readText(x.file)); } catch (e) { x.status = '실패: 파일 형식 오류'; } }
  const pageLid = {}; Object.values(lessonsIn).forEach(L => (L.pages || []).forEach(p => pageLid[p] = L.id));
  const todo = uplItems.filter(x => x.status !== '완료' && !x.status.startsWith('실패'));
  const one = async x => {
    x.status = '올리는 중'; renderUpl();
    try {
      if (x.kind === 'page') { const url = await readDataUrl(x.file); if (url.length > 890000) throw new Error('사진이 너무 큼'); await B.putPage(x.page, pageLid[x.page], url); }
      if (x.kind === 'lesson') await B.putLesson(x.lid, lessonsIn[x.lid]);
      if (x.kind === 'index') await B.putIndex(JSON.parse(await readText(x.file)));
      x.status = '완료';
    } catch (e) { x.status = '실패: ' + (e.code === 'permission-denied' ? '관리자 권한 없음' : e.message); }
    renderUpl();
  };
  for (const k of ['page', 'lesson', 'index']) {
    const q = todo.filter(x => x.kind === k);
    while (q.length) await Promise.all(q.splice(0, 4).map(one));
  }
  const bad = uplItems.filter(x => x.status.startsWith('실패')).length;
  if (bad) { toast(`${bad}개를 올리지 못했습니다`); renderUpl(); return; }
  toast('교재를 올렸습니다'); st.lessons = {}; await loadIndex();
  if (st.index) { $('#upl').hidden = true; await openLesson(st.lid && st.index.lessons.some(l => l.id === st.lid && l.ready) ? st.lid : firstReady(), 0); }
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
      <div class="pp-sub">${esc(r.email || '메일 정보 없음(직접 등록)')}${r.invite && r.invite.createdAt ? ` · 등록 ${fmtD(r.invite.createdAt)}` : ''}${r.member && r.member.joinedAt ? ` · 가입 ${fmtD(r.member.joinedAt)}` : ''}${r.invite && r.invite.stoppedAt && r.status === 'off' ? ` · 중지 ${fmtD(r.invite.stoppedAt)}` : ''}</div>
      ${r.memo ? `<p class="pp-memo">${esc(r.memo)}</p>` : ''}
      <div class="pp-btns">
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
$('#btn-people').addEventListener('click', () => { closeSheets(); $('#people').hidden = false; ppEdit = null; ppConfirm = null; loadPeople(); });
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

/* ---------------- 시작: 로그인 → 권한 확인 → 교재 ---------------- */
const firstReady = () => { const x = st.index.lessons.find(l => l.ready && l.no >= 1) || st.index.lessons.find(l => l.ready); return x ? x.id : null; };
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
  document.body.dataset.role = info.role || 'member'; st.me = info;
  $('#btn-logout').hidden = B.kind !== 'firebase';
  await loadIndex();
  await loadBooks().catch(() => {});
  gate('none');
  if (!st.index || !firstReady()) {
    $('#reader').innerHTML = `<div class="page-wrap"><h2>교재 데이터가 아직 없습니다</h2><p>${info.role === 'admin' ? '받은 <b>교재데이터</b> 폴더를 [교재 올리기]에서 올려 주세요.' : '관리자가 교재를 올리면 여기에 표시됩니다.'}</p></div>`;
    if (info.role === 'admin' && B.kind === 'firebase') openUploader();
    return;
  }
  const h = location.hash.slice(1); const m = h.match(/^(L\d\d)-U/);
  let lid = firstReady(), ui = 0;
  if (m && st.index.lessons.some(l => l.id === m[1] && l.ready)) {
    lid = m[1]; const L = await loadLesson(lid); ui = Math.max(0, L.body.findIndex(u => u.id === h));
  } else { const p = Store.pref('pos', null); if (p && st.index.lessons.some(l => l.id === p.lid && l.ready)) { lid = p.lid; ui = p.ui; } }
  await openLesson(lid, ui);
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
