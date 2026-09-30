/* 제자의 삶 — 사진 편집기 (자르기 · 회전 · 용량 맞춤 압축)
 * editImage(file) → { dataUrl, w, h, bytes, origBytes } 또는 취소 시 null
 * 저장 기준: 긴 변 최대 2000px, JPEG 화질을 0.9부터 조금씩 낮추며 약 650KB 이하로 맞춤
 * (Firestore 문서 한 개 한도 안에서 글씨·영수증이 읽히는 화질을 유지) */
const MAX_SIDE = 2000, MAX_B64 = 880000;
let ui = null;

function build() {
  const el = document.createElement('div');
  el.id = 'imged'; el.className = 'modal'; el.hidden = true;
  el.innerHTML = `
  <div class="modal-box ie-box" role="dialog" aria-label="사진 편집">
    <h3>사진 편집</h3>
    <div class="ie-stage"><div class="ie-wrap"><canvas class="ie-cv"></canvas>
      <div class="ie-crop"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div></div>
    <div class="ie-tools">
      <div class="seg ie-ratio"><button type="button" data-r="0" class="on">자유</button><button type="button" data-r="1">1:1</button><button type="button" data-r="1.3333">4:3</button><button type="button" data-r="0.75">3:4</button></div>
      <button type="button" class="ghost ie-rot">↻ 회전</button>
      <button type="button" class="ghost ie-reset">전체</button>
    </div>
    <p class="ie-info muted"></p>
    <div class="modal-act"><button type="button" class="ghost ie-cancel">취소</button><button type="button" class="primary ie-ok">사진 넣기</button></div>
  </div>`;
  document.body.appendChild(el);
  return {
    el, cv: el.querySelector('.ie-cv'), crop: el.querySelector('.ie-crop'), wrap: el.querySelector('.ie-wrap'),
    info: el.querySelector('.ie-info'), ok: el.querySelector('.ie-ok')
  };
}

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) {
    const url = URL.createObjectURL(file);
    try { const img = new Image(); img.src = url; await img.decode(); return img; } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB';
const b64Bytes = url => Math.round((url.length - url.indexOf(',') - 1) * 3 / 4);

export async function editImage(file) {
  if (!ui) ui = build();
  const src = await loadBitmap(file);
  const sw = src.width, sh = src.height;
  let rot = 0, ratio = 0, work, scale, crop;

  function makeWork() {
    const cap = Math.min(1, 4096 / Math.max(sw, sh));
    const w = Math.round(sw * cap), h = Math.round(sh * cap);
    const c = document.createElement('canvas');
    const r90 = rot % 180 !== 0; c.width = r90 ? h : w; c.height = r90 ? w : h;
    const g = c.getContext('2d'); g.translate(c.width / 2, c.height / 2); g.rotate(rot * Math.PI / 180); g.drawImage(src, -w / 2, -h / 2, w, h);
    work = c;
    const box = ui.el.querySelector('.ie-stage');
    const maxW = Math.min(box.clientWidth || 600, 900), maxH = Math.min(innerHeight * 0.58, 620);
    scale = Math.min(maxW / c.width, maxH / c.height, 1);
    ui.cv.width = Math.round(c.width * scale); ui.cv.height = Math.round(c.height * scale);
    ui.cv.getContext('2d').drawImage(c, 0, 0, ui.cv.width, ui.cv.height);
    ui.wrap.style.width = ui.cv.width + 'px'; ui.wrap.style.height = ui.cv.height + 'px';
    crop = { x: 0, y: 0, w: ui.cv.width, h: ui.cv.height }; if (ratio) fitRatio(); paint();
  }
  function fitRatio() {
    const W = ui.cv.width, H = ui.cv.height; let w = W, h = w / ratio; if (h > H) { h = H; w = h * ratio; }
    crop = { x: (W - w) / 2, y: (H - h) / 2, w, h };
  }
  function paint() {
    Object.assign(ui.crop.style, { left: crop.x + 'px', top: crop.y + 'px', width: crop.w + 'px', height: crop.h + 'px' });
    const ow = Math.round(crop.w / scale), oh = Math.round(crop.h / scale); const k = Math.min(1, MAX_SIDE / Math.max(ow, oh));
    ui.info.textContent = `원본 ${sw}×${sh} · ${kb(file.size)}  →  저장 ${Math.round(ow * k)}×${Math.round(oh * k)} (글씨가 읽히는 화질로 자동 압축)`;
  }

  // 자르기 상자 끌기
  let drag = null;
  const onDown = e => {
    const h = e.target.dataset.h || 'move'; drag = { h, x: e.clientX, y: e.clientY, c: { ...crop } };
    ui.crop.setPointerCapture(e.pointerId); e.preventDefault();
  };
  const onMove = e => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y, c = { ...drag.c }, W = ui.cv.width, H = ui.cv.height, MIN = 30;
    if (drag.h === 'move') { c.x = Math.min(Math.max(0, c.x + dx), W - c.w); c.y = Math.min(Math.max(0, c.y + dy), H - c.h); }
    else {
      let x1 = c.x, y1 = c.y, x2 = c.x + c.w, y2 = c.y + c.h;
      if (drag.h.includes('w')) x1 = Math.min(Math.max(0, x1 + dx), x2 - MIN); else x2 = Math.max(Math.min(W, x2 + dx), x1 + MIN);
      if (drag.h.includes('n')) y1 = Math.min(Math.max(0, y1 + dy), y2 - MIN); else y2 = Math.max(Math.min(H, y2 + dy), y1 + MIN);
      c.x = x1; c.y = y1; c.w = x2 - x1; c.h = y2 - y1;
      if (ratio) { const h2 = c.w / ratio; if (drag.h.includes('n')) c.y = c.y + c.h - h2; c.h = h2; if (c.y < 0 || c.y + c.h > H) return; }
    }
    crop = c; paint();
  };
  const onUp = () => { drag = null; };
  ui.crop.onpointerdown = onDown; ui.crop.onpointermove = onMove; ui.crop.onpointerup = onUp; ui.crop.onpointercancel = onUp;

  ui.el.querySelectorAll('.ie-ratio button').forEach(b => b.onclick = () => {
    ui.el.querySelectorAll('.ie-ratio button').forEach(x => x.classList.toggle('on', x === b));
    ratio = +b.dataset.r; if (ratio) fitRatio(); else crop = { x: 0, y: 0, w: ui.cv.width, h: ui.cv.height }; paint();
  });
  ui.el.querySelector('.ie-rot').onclick = () => { rot = (rot + 90) % 360; makeWork(); };
  ui.el.querySelector('.ie-reset').onclick = () => { ratio = 0; ui.el.querySelectorAll('.ie-ratio button').forEach((x, i) => x.classList.toggle('on', i === 0)); crop = { x: 0, y: 0, w: ui.cv.width, h: ui.cv.height }; paint(); };

  ui.el.hidden = false;
  await new Promise(r => requestAnimationFrame(r));
  makeWork();

  return new Promise(resolve => {
    const done = v => { ui.el.hidden = true; ui.ok.disabled = false; ui.ok.textContent = '사진 넣기'; resolve(v); };
    ui.el.querySelector('.ie-cancel').onclick = () => done(null);
    ui.ok.onclick = async () => {
      ui.ok.disabled = true; ui.ok.textContent = '저장 준비 중…';
      await new Promise(r => setTimeout(r, 20));
      const cx = crop.x / scale, cy = crop.y / scale, cw = crop.w / scale, ch = crop.h / scale;
      let k = Math.min(1, MAX_SIDE / Math.max(cw, ch)), url = null, w = 0, h = 0;
      for (let round = 0; round < 6 && !url; round++) {
        w = Math.max(1, Math.round(cw * k)); h = Math.max(1, Math.round(ch * k));
        const out = document.createElement('canvas'); out.width = w; out.height = h;
        const g = out.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.imageSmoothingQuality = 'high'; g.drawImage(work, cx, cy, cw, ch, 0, 0, w, h);
        for (const q of [0.9, 0.85, 0.8, 0.72, 0.64]) { const u = out.toDataURL('image/jpeg', q); if (u.length < MAX_B64) { url = u; break; } }
        k *= 0.85;
      }
      if (!url) { ui.ok.disabled = false; ui.ok.textContent = '사진 넣기'; ui.info.textContent = '사진이 너무 커서 넣을 수 없습니다. 더 작게 잘라 주세요.'; return; }
      done({ dataUrl: url, w, h, bytes: b64Bytes(url), origBytes: file.size });
    };
  });
}
