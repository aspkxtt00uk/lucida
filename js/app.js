/* Lucida — app shell: camera, overlay, gestures, filters, library, painting guide UI. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const CL = window.LucidaColour, LIB = window.LucidaLibrary, PL = window.LucidaPlanner;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ================= settings ================= */
  const KEY = 'lucida.settings.v2';
  const DEFAULTS = {
    opacity: 55, mode: 'original', lastAltMode: 'outline',
    brightness: 0, contrast: 0, saturation: 100,
    softness: 4, depth: 2, strength: 5, smoothing: 1, sensitivity: 55, weight: 1, lineColor: '#111111',
    grid: false, gridCells: 8, gridOpacity: 70, gridColor: '#ffffff',
    locked: false, wake: true,
    tf: { x: 0, y: 0, s: 1, r: 0, f: 1 },
    cameraId: null, cameraLabel: null, zoom: {},
    medium: 'cp', setByMedium: {}, excluded: {}, customColours: [], detail: 'balanced',
    view: 'layer', lastGuideView: 'layer', guideOpacity: 85, numbers: true, progress: {},
  };
  const S = (() => {
    try { const o = JSON.parse(localStorage.getItem(KEY) || '{}'); return { ...JSON.parse(JSON.stringify(DEFAULTS)), ...o, tf: { ...DEFAULTS.tf, ...(o.tf || {}) } }; }
    catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
  })();
  let saveT = 0;
  const saveNow = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full / private */ } };
  const save = () => { clearTimeout(saveT); saveT = setTimeout(saveNow, 250); };
  window.addEventListener('pagehide', saveNow);

  /* ================= elements ================= */
  const stage = $('#stage'), video = $('#video'), layer = $('#layer'), overlay = $('#overlay'), octx = overlay.getContext('2d');
  const guide = $('#guide'), gctx = guide.getContext('2d'), gridSvg = $('#grid'), gridPath = $('#gridPath');
  const sheet = $('#sheet'), toastEl = $('#toast'), hud = $('#hud'), fileInput = $('#file'), emptyCard = $('#emptyCard');
  const lensBtn = $('#lensBtn'), lensLabel = $('#lensLabel');

  let toastT = 0;
  function toast(msg, ms) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), ms || 1900); }
  let hudT = 0;
  function showHud(text) { hud.textContent = text; hud.classList.add('show'); clearTimeout(hudT); hudT = setTimeout(() => hud.classList.remove('show'), 700); }

  /* ================= IndexedDB ================= */
  const DB = (() => {
    let p = null;
    function open() {
      if (p) return p;
      p = new Promise((res, rej) => {
        if (!('indexedDB' in window)) return rej(new Error('IndexedDB unavailable'));
        const r = indexedDB.open('lucida', 1);
        r.onupgradeneeded = () => { const db = r.result; ['library', 'kv', 'analyses'].forEach((n) => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, n === 'library' ? { keyPath: 'id' } : undefined); }); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      p.catch(() => { p = null; });
      return p;
    }
    async function tx(store, mode, fn) {
      const db = await open();
      return new Promise((res, rej) => { const t = db.transaction(store, mode); const req = fn(t.objectStore(store)); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    }
    return {
      get: (s, k) => tx(s, 'readonly', (st) => st.get(k)),
      put: (s, v, k) => tx(s, 'readwrite', (st) => (k === undefined ? st.put(v) : st.put(v, k))),
      del: (s, k) => tx(s, 'readwrite', (st) => st.delete(k)),
      all: (s) => tx(s, 'readonly', (st) => st.getAll()),
    };
  })();

  /* ================= engine workers ================= */
  function makeWorker() { try { return new Worker('js/engine.js'); } catch (e) { return null; } }
  const Proc = (() => {
    let worker = makeWorker(), reqId = 0, floorId = 0, ver = 0, busy = false, pending = null, W = 0, H = 0, data = null;
    const local = window.LucidaEngine;
    function deliver(d) { if (d.v !== ver || d.id <= floorId) return; floorId = d.id; octx.putImageData(new ImageData(new Uint8ClampedArray(d.buffer), d.w, d.h), 0, 0); }
    function useLocal() { worker = null; if (data) local.setSrc(data.buffer, W, H); }
    if (worker) {
      worker.onmessage = (e) => { const d = e.data; if (d.type !== 'result') return; busy = false; deliver(d); if (pending) { const p = pending; pending = null; send(p); } };
      worker.onerror = () => { useLocal(); busy = false; if (pending) { const p = pending; pending = null; send(p); } };
    }
    function send(msg) {
      if (worker) { busy = true; worker.postMessage(msg); return; }
      const out = local.process(msg.params); deliver({ id: msg.id, v: msg.v, w: msg.w, h: msg.h, buffer: out.buffer });
    }
    return {
      setSource(d, w, h) { ver++; W = w; H = h; data = d; if (worker) { const c = d.slice(); worker.postMessage({ type: 'src', buffer: c.buffer, w, h }, [c.buffer]); } else local.setSrc(d.buffer, w, h); },
      run(params) { const msg = { type: 'process', id: ++reqId, params, w: W, h: H, v: ver }; if (worker && busy) { pending = msg; return; } send(msg); },
      skip() { floorId = reqId; pending = null; },
    };
  })();

  /* ================= image ================= */
  const MAXD = 1600;
  let img = null;
  function decode(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('decode')); };
      im.src = url;
    });
  }
  const toBlob = (rec) => rec.blob || new Blob([rec.buf], { type: rec.type || 'image/jpeg' });
  const canvasBlob = (c, alpha) => new Promise((r) => c.toBlob(r, alpha ? 'image/png' : 'image/jpeg', 0.92));
  function signature(d, w, h) { let x = 2166136261 ^ w ^ (h << 16); for (let i = 0; i < d.length; i += 97) { x ^= d[i]; x = Math.imul(x, 16777619); } return 's' + (x >>> 0).toString(36) + w + 'x' + h; }

  async function loadBlob(blob, o) {
    o = o || {};
    let im;
    try { im = await decode(blob); } catch (e) { toast('Couldn’t open that image'); return false; }
    const sw = im.naturalWidth || im.width, sh = im.naturalHeight || im.height;
    if (!sw || !sh) { toast('That image looks empty'); return false; }
    const k = Math.min(1, MAXD / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(im, 0, 0, w, h);
    const data = cx.getImageData(0, 0, w, h).data;
    let alpha = false; for (let i = 3; i < data.length; i += 4 * 13) if (data[i] < 250) { alpha = true; break; }
    img = { canvas: c, w, h, name: o.name || 'Reference', libId: o.libId || null, alpha, sig: o.sig || signature(data, w, h) }; // keep the original fingerprint across re-encodes
    overlay.width = w; overlay.height = h;
    Proc.setSource(data, w, h);
    computeBase();
    if (o.tf) S.tf = { ...DEFAULTS.tf, ...o.tf }; else if (o.resetTf !== false) S.tf = { ...DEFAULTS.tf };
    layer.classList.add('has-img');
    emptyCard.hidden = true;
    $('#imgName').textContent = img.name;
    applyTransform(); renderGrid(); applyOpacity(); processNow();
    if (o.persist !== false) persistCurrent();
    save(); renderLib();
    paintReset();
    restoreAnalysis();
    return true;
  }
  async function persistCurrent() {
    if (!img) return;
    try { const blob = await canvasBlob(img.canvas, img.alpha); await DB.put('kv', { buf: await blob.arrayBuffer(), type: blob.type, name: img.name, libId: img.libId, sig: img.sig }, 'current'); } catch (e) { /* ignore */ }
  }
  function computeBase() {
    const W = stage.clientWidth || innerWidth, H = stage.clientHeight || innerHeight;
    const k = Math.min((W * 0.86) / img.w, (H * 0.62) / img.h);
    img.bw = img.w * k; img.bh = img.h * k;
    layer.style.width = img.bw + 'px'; layer.style.height = img.bh + 'px';
  }

  /* ================= transform & gestures ================= */
  function applyTransform() {
    const t = S.tf;
    layer.style.transform = `translate(-50%,-50%) translate3d(${t.x}px,${t.y}px,0) rotate(${t.r}rad) scale(${t.s * t.f},${t.s})`;
    updateGridStroke();
  }
  function animateTf() { layer.classList.add('anim'); applyTransform(); setTimeout(() => layer.classList.remove('anim'), 340); save(); }
  function resetPosition() { if (!img) return; computeBase(); S.tf = { ...DEFAULTS.tf }; animateTf(); renderGrid(); toast('Position reset'); }
  const MIN_S = 0.05, MAX_S = 25;
  const degOf = (r) => { let d = ((r * 180) / Math.PI) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };
  const hudTf = () => showHud(`${Math.round(S.tf.s * 100)}% · ${Math.round(degOf(S.tf.r))}°`);

  const pts = new Map();
  let g = null, tap = null, lockHintT = 0;
  function snapshot() {
    const arr = [...pts.values()];
    g = { tf: { ...S.tf }, p: arr.map((p) => ({ x: p.x, y: p.y })) };
  }
  stage.addEventListener('pointerdown', (e) => {
    requestWake();
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) tap = { x: e.clientX, y: e.clientY, t: performance.now(), ok: true }; else if (tap) tap.ok = false;
    if (img && !S.locked) snapshot();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 10) tap.ok = false;
    if (!img || S.locked || !g) return;
    const arr = [...pts.values()];
    const cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
    if (arr.length === 1 && g.p.length === 1) {
      S.tf.x = g.tf.x + arr[0].x - g.p[0].x; S.tf.y = g.tf.y + arr[0].y - g.p[0].y;
    } else if (arr.length >= 2 && g.p.length >= 2) {
      const [a, b] = arr, [a0, b0] = g.p;
      const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b.x - a.x, b.y - a.y);
      if (d0 < 8) return;
      const ns = clamp(g.tf.s * (d1 / d0), MIN_S, MAX_S), k = ns / g.tf.s;
      const dr = Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x);
      let r = g.tf.r + dr;
      const deg = degOf(r), near = Math.round(deg / 90) * 90;
      if (Math.abs(deg - near) < 2.5) r += ((near - deg) * Math.PI) / 180;
      const realDr = r - g.tf.r;
      const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const vx = cx + g.tf.x - m0.x, vy = cy + g.tf.y - m0.y, c = Math.cos(realDr), s = Math.sin(realDr);
      S.tf.x = m1.x + (vx * c - vy * s) * k - cx; S.tf.y = m1.y + (vx * s + vy * c) * k - cy;
      S.tf.s = ns; S.tf.r = r;
      hudTf();
    }
    applyTransform();
  });
  const endPointer = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 0 && tap && tap.ok && performance.now() - tap.t < 450) handleTap(tap.x, tap.y);
    if (pts.size === 0) tap = null;
    if (img && !S.locked) { snapshot(); save(); }
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('wheel', (e) => {
    if (!img || S.locked) return;
    e.preventDefault();
    const cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
    if (e.shiftKey) { S.tf.r += e.deltaY * 0.003; }
    else {
      const ns = clamp(S.tf.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), MIN_S, MAX_S), k = ns / S.tf.s;
      const ix = cx + S.tf.x, iy = cy + S.tf.y;
      S.tf.x = e.clientX + (ix - e.clientX) * k - cx; S.tf.y = e.clientY + (iy - e.clientY) * k - cy; S.tf.s = ns;
    }
    applyTransform(); hudTf(); save();
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', (e) => { if (!e.target.closest('.sheet, input[type=range]')) e.preventDefault(); }, { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault());

  function handleTap(x, y) {
    if (img && paint.plan && S.view !== 'photo') { const id = regionAt(x, y); if (id != null) { inspectRegion(id); return; } }
    if (sheet.classList.contains('open')) { openTab(null); return; }
    if (S.locked && img && performance.now() - lockHintT > 2500) { lockHintT = performance.now(); toast('Photo is locked — tap the lock to move it'); }
  }
  function screenToImage(x, y) {
    if (!img) return null;
    const t = S.tf, cx = stage.clientWidth / 2 + t.x, cy = stage.clientHeight / 2 + t.y;
    const dx = x - cx, dy = y - cy, c = Math.cos(-t.r), s = Math.sin(-t.r);
    const ux = (dx * c - dy * s) / (t.s * t.f), uy = (dx * s + dy * c) / t.s;
    const u = ux / img.bw + 0.5, v = uy / img.bh + 0.5;
    return u >= 0 && u < 1 && v >= 0 && v < 1 ? { u, v } : null;
  }
  function regionAt(x, y) { const p = screenToImage(x, y), A = paint.analysis; if (!p || !A) return null; return A.labels[Math.floor(p.v * A.h) * A.w + Math.floor(p.u * A.w)]; }

  /* ================= overlay filters ================= */
  let rafP = 0;
  const PROC_KEYS = new Set(['mode', 'brightness', 'contrast', 'saturation', 'softness', 'depth', 'strength', 'smoothing', 'sensitivity', 'weight', 'lineColor']);
  function scheduleProcess() { if (!img || rafP) return; rafP = requestAnimationFrame(() => { rafP = 0; processNow(); }); }
  function processNow() {
    if (!img) return;
    if (S.mode === 'original' && !+S.brightness && !+S.contrast && +S.saturation === 100) { Proc.skip(); octx.clearRect(0, 0, img.w, img.h); octx.drawImage(img.canvas, 0, 0); return; }
    Proc.run({ mode: S.mode, brightness: +S.brightness, contrast: +S.contrast, saturation: +S.saturation, softness: +S.softness, depth: +S.depth, strength: +S.strength, smoothing: +S.smoothing, sensitivity: +S.sensitivity, weight: +S.weight, lineRGB: CL.hexToRgb(S.lineColor) });
  }
  function applyOpacity() { overlay.style.opacity = S.opacity / 100; }

  /* ================= grid ================= */
  function renderGrid() {
    if (!img) return;
    gridSvg.style.display = S.grid ? 'block' : 'none';
    if (!S.grid) return;
    gridSvg.setAttribute('viewBox', `0 0 ${img.w} ${img.h}`);
    const n = S.gridCells, cell = img.w / n; let d = '';
    for (let i = 0; i <= n; i++) { const x = +(i * cell).toFixed(2); d += `M${x} 0V${img.h}`; }
    for (let y = 0; y < img.h - 0.5; y += cell) d += `M0 ${+y.toFixed(2)}H${img.w}`;
    d += `M0 ${img.h}H${img.w}`;
    gridPath.setAttribute('d', d); gridPath.setAttribute('stroke', S.gridColor);
    gridSvg.style.opacity = S.gridOpacity / 100;
    updateGridStroke();
  }
  function updateGridStroke() { if (!img || !S.grid) return; const unit = (img.bw / img.w) * S.tf.s; gridPath.setAttribute('stroke-width', (1.1 / unit).toFixed(3)); }

  /* ================= UI bindings ================= */
  const FMT = {
    opacity: (v) => v + '%', brightness: (v) => (v > 0 ? '+' : '') + v, contrast: (v) => (v > 0 ? '+' : '') + v, saturation: (v) => v + '%',
    gridCells: (v) => v + ' cells', gridOpacity: (v) => v + '%', weight: (v) => v + '×', guideOpacity: (v) => v + '%',
  };
  function paintRange(inp) {
    const p = ((inp.value - inp.min) / (inp.max - inp.min)) * 100; inp.style.setProperty('--p', p + '%');
    const k = inp.dataset.bind; if (!k) return;
    $$(`[data-out="${k}"]`).forEach((o) => { o.textContent = (FMT[k] || String)(+inp.value); });
  }
  function syncUI() {
    $$('input[data-bind]').forEach((inp) => { inp.value = S[inp.dataset.bind]; paintRange(inp); });
    $$('[data-group]').forEach((grp) => { const k = grp.dataset.group; $$('[data-value]', grp).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(S[k])))); });
    $$('[data-bool]').forEach((b) => b.setAttribute('aria-checked', String(!!S[b.dataset.bool])));
    $$('[data-modes]').forEach((el) => { el.hidden = !el.dataset.modes.split(' ').includes(S.mode); });
    const alt = S.mode === 'original' ? S.lastAltMode : S.mode;
    const q = $('#quickLines'); q.setAttribute('aria-pressed', String(S.mode !== 'original')); q.textContent = alt === 'outline' ? 'Lines' : alt[0].toUpperCase() + alt.slice(1);
    const qg = $('#quickGuide'); qg.hidden = !paint.plan; qg.setAttribute('aria-pressed', String(S.view !== 'photo'));
    applyLockUI();
  }
  function onChange(k) {
    if (PROC_KEYS.has(k)) scheduleProcess();
    if (k === 'mode') $$('[data-modes]').forEach((el) => { el.hidden = !el.dataset.modes.split(' ').includes(S.mode); });
    if (k === 'opacity') applyOpacity();
    if (k.startsWith('grid')) renderGrid();
    if (k === 'guideOpacity') guide.style.opacity = S.guideOpacity / 100;
    if (k === 'numbers' || k === 'view') renderGuide();
    if (k === 'view') { if (S.view !== 'photo') S.lastGuideView = S.view; syncUI(); }
    if (k === 'wake') { if (S.wake) requestWake(); else releaseWake(); }
    if (k === 'detail') renderSetup();
    save();
  }
  function bindUI() {
    $$('input[data-bind]').forEach((inp) => inp.addEventListener('input', () => { S[inp.dataset.bind] = +inp.value; paintRange(inp); onChange(inp.dataset.bind); }));
    $$('[data-group]').forEach((grp) => grp.addEventListener('click', (e) => {
      const b = e.target.closest('[data-value]'); if (!b) return;
      const k = grp.dataset.group; S[k] = b.dataset.value;
      $$('[data-value]', grp).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange(k); if (k === 'mode') syncUI();
    }));
    $$('[data-bool]').forEach((b) => b.addEventListener('click', () => { const k = b.dataset.bool; S[k] = !S[k]; b.setAttribute('aria-checked', String(S[k])); onChange(k); }));
    $$('.tab').forEach((t) => t.addEventListener('click', () => openTab(t.dataset.tab)));
    $('#quickLines').addEventListener('click', () => {
      if (S.mode === 'original') S.mode = S.lastAltMode || 'outline'; else { S.lastAltMode = S.mode; S.mode = 'original'; }
      syncUI(); onChange('mode');
    });
    $('#quickGuide').addEventListener('click', () => { S.view = S.view === 'photo' ? S.lastGuideView || 'layer' : 'photo'; syncUI(); onChange('view'); renderPlan(); });
    $('#resetAdj').addEventListener('click', () => { S.brightness = 0; S.contrast = 0; S.saturation = 100; syncUI(); scheduleProcess(); save(); });
    $('#resetBtn').addEventListener('click', resetPosition);
    $('#fitBtn').addEventListener('click', resetPosition);
    $('#rotBtn').addEventListener('click', () => { if (!img) return; S.tf.r = Math.round((S.tf.r + Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2); animateTf(); hudTf(); });
    $('#flipBtn').addEventListener('click', () => { if (!img) return; S.tf.f *= -1; animateTf(); toast(S.tf.f < 0 ? 'Flipped (mirrored)' : 'Flip off'); });
    $('#lockBtn').addEventListener('click', () => { S.locked = !S.locked; pts.clear(); applyLockUI(); save(); toast(S.locked ? 'Photo locked in place' : 'Photo unlocked'); });
    $('#hideBtn').addEventListener('click', () => { openTab(null); document.body.classList.add('ui-hidden'); });
    $('#restoreBtn').addEventListener('click', () => document.body.classList.remove('ui-hidden'));
    $('#lensBtn').addEventListener('click', () => openTab('camera'));
    $('#saveBtn').addEventListener('click', saveCurrent);
    $('#emptyLib').addEventListener('click', () => openTab('photo'));
    $('#camRetry').addEventListener('click', () => startCamera({ id: S.cameraId, noSwitch: false }));
    $('#camDismiss').addEventListener('click', () => { $('#camNotice').hidden = true; });
    $('#camRestart').addEventListener('click', () => startCamera({ id: S.cameraId, noSwitch: true }));
    $('#torchSw').addEventListener('click', toggleTorch);
    $('#zoomInput').addEventListener('input', onZoom);
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files && fileInput.files[0]; fileInput.value = '';
      if (!f) return;
      if (f.type && !f.type.startsWith('image/')) return toast('That file isn’t an image');
      toast('Loading…');
      if (await loadBlob(f, { name: f.name.replace(/\.[^.]+$/, '') || 'Reference' })) { toast('Photo loaded'); openTab(null); }
    });
    stage.addEventListener('dragover', (e) => e.preventDefault());
    stage.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) loadBlob(f, { name: f.name.replace(/\.[^.]+$/, '') }); });
    const fsOK = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone && !fsOK) $('#fsBtn').hidden = true;
    $('#fsBtn').addEventListener('click', () => {
      if (fsOK) {
        const el = document.documentElement;
        if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      } else toast('For true full-screen on iPhone: Share → Add to Home Screen, then open Lucida from there', 4200);
    });
    window.addEventListener('resize', () => { if (img) updateGridStroke(); });
    bindPaintUI();
  }
  const LOCK_ON = '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
  const LOCK_OFF = '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 7.6-1.8"/>';
  function applyLockUI() { $('#lockBtn').setAttribute('aria-pressed', String(!!S.locked)); $('#lockIcon').innerHTML = S.locked ? LOCK_ON : LOCK_OFF; }

  let curTab = null;
  function openTab(name) {
    if (curTab === name) name = null;
    curTab = name;
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    sheet.classList.toggle('open', !!name);
    document.body.classList.toggle('sheet-open', !!name);
    sheet.classList.toggle('tall', name === 'paint');
    $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
    if (name === 'camera') renderCamList();
    if (name === 'photo') renderLib();
    if (name === 'paint') renderPaint();
    if (name) sheet.scrollTop = 0;
  }

  /* ================= library ================= */
  function makeThumb(c) {
    const t = document.createElement('canvas'); t.width = t.height = 144;
    const k = Math.max(144 / c.width, 144 / c.height), w = c.width * k, h = c.height * k;
    const x = t.getContext('2d'); x.fillStyle = '#222'; x.fillRect(0, 0, 144, 144); x.drawImage(c, (144 - w) / 2, (144 - h) / 2, w, h);
    return t.toDataURL('image/jpeg', 0.8);
  }
  async function saveCurrent() {
    if (!img) return toast('Choose a photo first');
    if (img.libId) return toast('Already in your library');
    try {
      const blob = await canvasBlob(img.canvas, img.alpha);
      // stored as ArrayBuffer: some Safari/WebKit contexts refuse Blobs in IndexedDB
      const it = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: img.name, created: Date.now(), buf: await blob.arrayBuffer(), type: blob.type, sig: img.sig, thumb: makeThumb(img.canvas), w: img.w, h: img.h, tf: { ...S.tf } };
      await DB.put('library', it); img.libId = it.id; persistCurrent(); renderLib(); toast('Saved to library');
    } catch (e) { toast('Couldn’t save — storage may be full or blocked (private browsing?)', 3000); }
  }
  async function renderLib() {
    const el = $('#lib'); let items = [];
    try { items = (await DB.all('library')).sort((a, b) => b.created - a.created); }
    catch (e) { el.innerHTML = '<div class="empty-lib">Saving isn’t available in this browser mode.</div>'; return; }
    $('#libCount').textContent = items.length ? String(items.length) : '';
    $('#emptyLib').hidden = !items.length;
    if (!items.length) { el.innerHTML = '<div class="empty-lib">No saved references yet. Tap <b>Save</b> to keep the current photo (and its position) on this device.</div>'; return; }
    el.innerHTML = '';
    for (const it of items) {
      const d = document.createElement('div');
      d.className = 'thumb' + (img && img.libId === it.id ? ' current' : '');
      d.style.backgroundImage = `url("${it.thumb}")`; d.setAttribute('role', 'button'); d.title = it.name;
      d.innerHTML = '<button class="del" aria-label="Delete">×</button>';
      d.addEventListener('click', async (e) => {
        if (e.target.closest('.del')) return;
        if (await loadBlob(toBlob(it), { name: it.name, libId: it.id, tf: it.tf, sig: it.sig })) toast('Loaded “' + it.name + '”');
      });
      $('.del', d).addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete “${it.name}” from your library?`)) return;
        try { await DB.del('library', it.id); } catch (_) {}
        if (img && img.libId === it.id) { img.libId = null; persistCurrent(); }
        renderLib(); toast('Deleted');
      });
      el.append(d);
    }
  }
  async function restoreCurrent() {
    try { const cur = await DB.get('kv', 'current'); if (cur && (cur.buf || cur.blob)) await loadBlob(toBlob(cur), { name: cur.name, libId: cur.libId, sig: cur.sig, resetTf: false, persist: false }); } catch (e) { /* none */ }
    if (!img) emptyCard.hidden = false;
    renderLib();
  }

  /* ================= camera ================= */
  const Cam = { stream: null, track: null, devices: [], kind: null, starting: false, endedRetries: 0 };
  function classify(label) {
    const l = (label || '').toLowerCase();
    if (/front|frontal|delantera|facetime|user|avant/.test(l)) return 'front';
    if (/ultra/.test(l)) return 'ultra';
    if (/tele/.test(l)) return 'tele';
    if (/dual|triple|doble|double/.test(l)) return 'multi';
    if (/back|rear|trasera|posterior|environment|arri[eè]re|camera|cámara/.test(l)) return 'wide';
    return 'other';
  }
  const KIND = { ultra: ['0.5×', 'Ultra Wide 0.5×', 0], wide: ['1×', 'Wide 1×', 1], tele: ['Tele', 'Telephoto', 2], multi: ['Auto', 'Auto (multi-lens)', 3], other: ['Cam', 'Camera', 4], front: ['Front', 'Front', 5] };
  const named = (name, message) => Object.assign(new Error(message || name), { name });
  async function listCams() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      Cam.devices = all.filter((d) => d.kind === 'videoinput').map((d, i) => ({ id: d.deviceId, label: d.label, kind: d.label ? classify(d.label) : 'other', idx: i }));
    } catch (e) { Cam.devices = []; }
    return Cam.devices;
  }
  const sortDevs = (ds) => ds.slice().sort((a, b) => KIND[a.kind][2] - KIND[b.kind][2]);
  function pickPreferred(devs) {
    if (S.cameraLabel) { const m = devs.find((d) => d.label === S.cameraLabel); if (m) return m; }
    return devs.find((d) => d.kind === 'ultra') || null;
  }
  function stopCam() { if (Cam.stream) Cam.stream.getTracks().forEach((t) => t.stop()); Cam.stream = null; Cam.track = null; video.srcObject = null; video.classList.remove('live'); lensBtn.classList.remove('live'); }
  const constraintsFor = (id) => {
    const base = { width: { ideal: 1920 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } };
    return { audio: false, video: id ? { ...base, deviceId: { exact: id } } : { ...base, facingMode: { ideal: 'environment' } } };
  };
  async function startCamera(opts) {
    opts = opts || {};
    if (Cam.starting) return;
    Cam.starting = true; $('#camNotice').hidden = true; lensLabel.textContent = '…';
    try {
      if (!window.isSecureContext) throw named('InsecureError');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw named('UnsupportedError');
      stopCam();
      let target = opts.id || null;
      if (!target) {
        const devs = await listCams();
        if (devs.some((d) => d.label)) { const p = pickPreferred(devs); target = p ? p.id : null; }
        else if (S.cameraId && devs.some((d) => d.id === S.cameraId)) target = S.cameraId;
      }
      let stream = null, lastErr = null; const tried = [];
      for (const a of target ? [target, null] : [null]) {
        tried.push(a);
        try { stream = await navigator.mediaDevices.getUserMedia(constraintsFor(a)); break; }
        catch (e) { lastErr = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e; }
      }
      if (!stream) { // a lens may be broken/busy: try every camera, ultra-wide first
        for (const d of sortDevs(await listCams())) {
          if (!d.id || tried.includes(d.id)) continue;
          try { stream = await navigator.mediaDevices.getUserMedia(constraintsFor(d.id)); break; } catch (e) { lastErr = e; if (e.name === 'NotAllowedError') throw e; }
        }
      }
      if (!stream) throw lastErr || named('NotFoundError');
      Cam.stream = stream; Cam.track = stream.getVideoTracks()[0];
      video.srcObject = stream;
      try { await video.play(); } catch (e) { /* will retry on next tap */ }
      const devs = await listCams();
      const settings = Cam.track.getSettings ? Cam.track.getSettings() : {};
      if (!opts.noSwitch && !opts.id) {
        const pref = pickPreferred(devs);
        if (pref && settings.deviceId && pref.id !== settings.deviceId) { Cam.starting = false; return await startCamera({ id: pref.id, noSwitch: true }); }
      }
      const cur = devs.find((d) => d.id === settings.deviceId);
      Cam.kind = classify(Cam.track.label) !== 'other' ? classify(Cam.track.label) : cur ? cur.kind : settings.facingMode === 'user' ? 'front' : 'other';
      S.cameraId = settings.deviceId || S.cameraId; save();
      video.classList.add('live'); lensBtn.classList.add('live');
      video.classList.toggle('mirror', Cam.kind === 'front');
      lensLabel.textContent = KIND[Cam.kind][0];
      Cam.track.addEventListener('ended', () => {
        if (document.visibilityState === 'visible' && Cam.endedRetries++ < 3) setTimeout(() => startCamera({ id: S.cameraId, noSwitch: true }), 500);
      });
      setupCaps(settings);
      renderCamList();
      requestWake();
    } catch (e) { showCamError(e); }
    finally { Cam.starting = false; }
  }
  function showCamError(e) {
    stopCam();
    const n = (e && e.name) || 'Error';
    const denied = ['Camera access is off', 'Allow the camera so you can see your paper. In Safari tap “aA” in the address bar → Website Settings → Camera → Allow, then tap Try again. (Also check Settings → Safari → Camera.)'];
    const busy = ['Camera is busy', 'Another app or tab is using the camera. Close it, then tap Try again.'];
    const M = {
      NotAllowedError: denied, SecurityError: denied, PermissionDeniedError: denied,
      InsecureError: ['Secure connection needed', 'The camera only works over https://. Open the deployed https link (GitHub Pages, Netlify, Cloudflare Pages…) rather than a local http:// address.'],
      UnsupportedError: ['Camera not supported here', 'This browser can’t access the camera. On iPhone, open the link in Safari (iOS 14.3 or newer).'],
      NotFoundError: ['No camera found', 'No camera is available. You can still use the overlay without the camera.'],
      OverconstrainedError: ['Lens unavailable', 'The selected lens couldn’t be opened. Try another lens in the Camera panel.'],
      NotReadableError: busy, AbortError: busy, TrackStartError: busy,
    };
    const [t, m] = M[n] || ['Camera didn’t start', (e && e.message) || 'Something went wrong starting the camera.'];
    $('#camTitle').textContent = t; $('#camMsg').textContent = m; $('#camNotice').hidden = false;
    lensLabel.textContent = 'Off';
  }
  function setupCaps(settings) {
    const caps = Cam.track && Cam.track.getCapabilities ? Cam.track.getCapabilities() : {};
    const zf = $('#zoomField'), zi = $('#zoomInput');
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      zf.hidden = false; zi.min = caps.zoom.min; zi.max = caps.zoom.max; zi.step = caps.zoom.step || 0.01;
      let z = S.zoom[S.cameraId];
      if (z == null) z = Cam.kind === 'multi' && caps.zoom.min < 1 ? caps.zoom.min : settings.zoom || caps.zoom.min;
      z = clamp(z, caps.zoom.min, caps.zoom.max); zi.value = z; applyZoom(z);
    } else zf.hidden = true;
    $('#torchRow').hidden = !caps.torch;
    $('#torchSw').setAttribute('aria-checked', 'false');
    const s = settings || {};
    $('#camInfo').textContent = [Cam.track && Cam.track.label, s.width && s.height ? `${s.width}×${s.height}` : ''].filter(Boolean).join(' · ');
  }
  function applyZoom(z) {
    $('#zoomOut').textContent = (+z).toFixed(2) + '×';
    const zi = $('#zoomInput'); zi.style.setProperty('--p', ((z - zi.min) / (zi.max - zi.min || 1)) * 100 + '%');
    if (Cam.track && Cam.track.applyConstraints) Cam.track.applyConstraints({ advanced: [{ zoom: +z }] }).catch(() => {});
  }
  let zoomRaf = 0;
  function onZoom() { const z = +$('#zoomInput').value; S.zoom[S.cameraId] = z; save(); cancelAnimationFrame(zoomRaf); zoomRaf = requestAnimationFrame(() => applyZoom(z)); }
  async function toggleTorch() {
    const sw = $('#torchSw'), on = sw.getAttribute('aria-checked') !== 'true';
    try { await Cam.track.applyConstraints({ advanced: [{ torch: on }] }); sw.setAttribute('aria-checked', String(on)); } catch (e) { toast('Torch isn’t available on this lens'); }
  }
  function renderCamList() {
    const el = $('#camList'); const devs = sortDevs(Cam.devices);
    if (!devs.length || !devs.some((d) => d.label)) { el.innerHTML = '<p class="hint" style="margin:0">Allow camera access to choose a lens.</p>'; return; }
    const cur = Cam.track && Cam.track.getSettings ? Cam.track.getSettings().deviceId : null;
    const seen = {};
    el.innerHTML = '';
    for (const d of devs) {
      seen[d.kind] = (seen[d.kind] || 0) + 1;
      const b = document.createElement('button'); b.className = 'chip';
      b.setAttribute('aria-pressed', String(d.id === cur));
      b.innerHTML = `${esc(KIND[d.kind][1])}${seen[d.kind] > 1 ? ' ' + seen[d.kind] : ''} <small>${esc(d.label.replace(/camera|cámara/i, '').trim().slice(0, 28))}</small>`;
      b.addEventListener('click', () => { S.cameraLabel = d.label; S.cameraId = d.id; save(); startCamera({ id: d.id, noSwitch: true }); });
      el.append(b);
    }
  }
  let wake = null;
  async function requestWake() {
    if (!S.wake || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wake && !wake.released) return;
    try { wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed yet */ }
  }
  function releaseWake() { if (wake) { wake.release().catch(() => {}); wake = null; } }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    requestWake();
    if (Cam.track && Cam.track.readyState === 'ended') startCamera({ id: S.cameraId, noSwitch: true });
    else if (Cam.stream && video.paused) video.play().catch(() => {});
  });

  /* ================= painting assistant ================= */
  const paint = { analysis: null, plan: null, layer: 0, app: null, region: null, busy: false, sub: 'setup', worker: null, jobId: 0, lastIdx: null };
  const setColours = (setId) => {
    const base = setId === 'custom' ? S.customColours : (LIB.SETS[setId] || LIB.SETS['generic-pencil-48']).colours;
    const ex = new Set(S.excluded[setId] || []);
    return base.filter((c) => !ex.has(c.code));
  };
  const curSet = () => { const m = LIB.MEDIA[S.medium]; const s = S.setByMedium[S.medium]; return m.sets.includes(s) ? s : m.sets[0]; };
  const progKey = () => img && img.sig + ':' + S.medium;
  const progress = () => { const k = progKey(); if (!k) return { layer: 0, done: [] }; if (!S.progress[k]) S.progress[k] = { layer: 0, done: [] }; return S.progress[k]; };

  function paintReset() { paint.analysis = null; paint.plan = null; paint.app = null; paint.region = null; paint.sub = 'setup'; guide.classList.remove('on'); syncUI(); if (curTab === 'paint') renderPaint(); }
  async function restoreAnalysis() {
    if (!img) return;
    const sig = img.sig;
    try {
      const rec = await DB.get('analyses', sig);
      if (rec && rec.analysis && img && img.sig === sig) { setAnalysis(rec.analysis, false); }
    } catch (e) { /* none */ }
  }
  function setAnalysis(A, fresh) {
    paint.analysis = A;
    guide.width = A.w; guide.height = A.h;
    buildPlan();
    const p = progress(); paint.layer = clamp(p.layer || 0, 0, paint.plan.layers.length - 1);
    paint.sub = 'plan';
    if (fresh) { S.view = 'layer'; S.lastGuideView = 'layer'; }
    syncUI(); renderGuide(); if (curTab === 'paint') renderPaint();
  }
  function buildPlan() {
    if (!paint.analysis) return;
    const setId = curSet();
    paint.plan = PL.build(paint.analysis, { medium: S.medium, setId, colours: setColours(setId) });
    paint.app = null; paint.lastIdx = null;
    paint.layer = clamp(paint.layer, 0, paint.plan.layers.length - 1);
  }
  function analysisImage() {
    const k = Math.min(1, 1000 / Math.max(img.w, img.h)), w = Math.max(8, Math.round(img.w * k)), h = Math.max(8, Math.round(img.h * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img.canvas, 0, 0, w, h);
    return { data: x.getImageData(0, 0, w, h).data, w, h };
  }
  function runAnalysis() {
    if (!img || paint.busy) return;
    paint.busy = true; paint.sub = 'progress'; renderPaint(); setProgress(0.01, 'Preparing image');
    const { data, w, h } = analysisImage();
    const sig = img.sig, id = ++paint.jobId, detail = S.detail;
    const done = (A) => {
      paint.busy = false;
      if (!img || img.sig !== sig || id !== paint.jobId) return;
      DB.put('analyses', { analysis: A, created: Date.now(), detail }, sig).catch(() => {});
      setAnalysis(A, true);
      toast(`${A.regions.length} regions analysed — Layer 1 is ready`, 2600);
    };
    const fail = (msg) => { paint.busy = false; paint.sub = 'setup'; renderPaint(); toast('Analysis failed: ' + msg, 4000); };
    if (!paint.worker) paint.worker = makeWorker();
    const wk = paint.worker;
    if (wk) {
      wk.onmessage = (e) => {
        const d = e.data; if (d.id !== id) return;
        if (d.type === 'progress') setProgress(d.p, d.msg);
        else if (d.type === 'analysis') done(d.result);
        else if (d.type === 'error') fail(d.message);
      };
      wk.onerror = (e) => { paint.worker = null; fail((e && e.message) || 'worker error'); };
      const buf = data.slice().buffer;
      wk.postMessage({ type: 'analyze', id, buffer: buf, w, h, detail }, [buf]);
    } else {
      setTimeout(() => { try { done(window.LucidaEngine.analyze(new Uint8ClampedArray(data), w, h, detail, () => {})); } catch (e) { fail(e.message); } }, 60);
    }
  }
  function setProgress(p, msg) { $('#progBar').style.width = Math.round(p * 100) + '%'; $('#progMsg').textContent = msg || ''; }

  /* ---------- guide rendering ---------- */
  function renderGuide() {
    const A = paint.analysis, P = paint.plan;
    guide.style.opacity = S.guideOpacity / 100;
    if (!A || !P || S.view === 'photo') { guide.classList.remove('on'); return; }
    guide.classList.add('on');
    const R = A.regions.length, tbl = new Uint8ClampedArray(R * 4), avoid = new Uint8Array(R), reserve = new Uint8Array(R), active = new Uint8Array(R);
    const layerObj = P.layers[paint.layer];
    if (S.view === 'map') {
      A.regions.forEach((r, i) => { const c = CL.hexToRgb(r.hex); tbl.set([c[0], c[1], c[2], 255], i * 4); active[i] = 1; });
    } else if (layerObj) {
      layerObj.apps.forEach((a, ai) => {
        if (paint.app != null && paint.app !== ai) return;
        const c = CL.hexToRgb(a.kind === 'reserve' ? '#ffffff' : a.match.hex);
        for (const rr of a.regions) {
          const o = rr.id * 4;
          if (a.kind === 'reserve') { reserve[rr.id] = 1; tbl.set([255, 255, 255, 215], o); active[rr.id] = 1; continue; }
          const al = Math.round(255 * (0.22 + 0.73 * rr.I));
          if (al > tbl[o + 3]) tbl.set([c[0], c[1], c[2], al], o);
          active[rr.id] = 1;
        }
      });
      if (paint.app == null) for (const id of layerObj.avoid) if (!active[id]) avoid[id] = 1;
    }
    const W = A.w, H = A.h, lab = A.labels, bm = A.bmask, out = new Uint8ClampedArray(W * H * 4);
    const sel = paint.region;
    for (let y = 0, j = 0; y < H; y++) for (let x = 0; x < W; x++, j++) {
      const r = lab[j], o = j * 4, t = r * 4;
      let R0 = tbl[t], G0 = tbl[t + 1], B0 = tbl[t + 2], A0 = tbl[t + 3];
      if (avoid[r] && (x + y) % 16 < 3) { R0 = 255; G0 = 84; B0 = 72; A0 = 150; }
      if (reserve[r] && (x - y + 4096) % 18 < 2) { R0 = 120; G0 = 150; B0 = 255; A0 = 200; }
      const b = bm[j];
      if (b) { const ba = b === 2 ? (active[r] ? 210 : 120) : active[r] ? 110 : 45; const k = ba / 255; R0 = R0 * (1 - k) + 22 * k; G0 = G0 * (1 - k) + 22 * k; B0 = B0 * (1 - k) + 26 * k; A0 = Math.max(A0, ba); }
      if (sel != null && r === sel) {
        let edge = false;
        for (let d = 1; d <= 3 && !edge; d++) { if ((x >= d && lab[j - d] !== sel) || (x + d < W && lab[j + d] !== sel) || (y >= d && lab[j - d * W] !== sel) || (y + d < H && lab[j + d * W] !== sel)) edge = true; }
        if (edge) { R0 = 230; G0 = 184; B0 = 115; A0 = 255; }
      }
      out[o] = R0; out[o + 1] = G0; out[o + 2] = B0; out[o + 3] = A0;
    }
    gctx.putImageData(new ImageData(out, W, H), 0, 0);
    if (S.numbers) drawNumbers(A, active);
  }
  function labelPoint(A, r) {
    if (r._lp) return r._lp;
    const W = A.w, H = A.h, cx = r.cx * W, cy = r.cy * H, id = r.id;
    const at = (x, y) => A.labels[Math.round(clamp(y, 0, H - 1)) * W + Math.round(clamp(x, 0, W - 1))] === id;
    let best = at(cx, cy) ? [cx, cy] : null;
    if (!best) {
      const [x0, y0, x1, y1] = [r.bbox[0] * W, r.bbox[1] * H, r.bbox[2] * W, r.bbox[3] * H]; let bd = Infinity;
      for (let i = 0; i <= 10; i++) for (let k = 0; k <= 10; k++) { const x = x0 + ((x1 - x0) * i) / 10, y = y0 + ((y1 - y0) * k) / 10; if (!at(x, y)) continue; const d = Math.hypot(x - cx, y - cy); if (d < bd) { bd = d; best = [x, y]; } }
    }
    r._lp = best || [cx, cy];
    return r._lp;
  }
  function drawNumbers(A, active) {
    const px = A.w / img.bw / Math.max(0.35, S.tf.s); // guide px per CSS px on screen
    const fs = clamp(11 * px, 8, 64);
    gctx.font = `600 ${fs}px -apple-system, system-ui, sans-serif`; gctx.textAlign = 'center'; gctx.textBaseline = 'middle';
    gctx.lineWidth = Math.max(2, fs * 0.22); gctx.lineJoin = 'round';
    for (const r of A.regions) {
      if (!active[r.id]) continue;
      if (Math.sqrt(r.area) < fs * 1.6 && r.id !== paint.region) continue;
      const [x, y] = labelPoint(A, r), t = String(r.id + 1);
      gctx.strokeStyle = 'rgba(0,0,0,.72)'; gctx.strokeText(t, x, y);
      gctx.fillStyle = r.id === paint.region ? '#e6b873' : '#fff'; gctx.fillText(t, x, y);
    }
  }

  /* ---------- paint panel ---------- */
  function showSub(name) { ['pNoImg', 'pSetup', 'pProgress', 'pPlan', 'pRegion', 'pOwned'].forEach((id) => { $('#' + id).hidden = id !== name; }); }
  function renderPaint() {
    if (!img) return showSub('pNoImg');
    if (paint.busy) return showSub('pProgress');
    if (paint.sub === 'owned') { renderOwned(); return showSub('pOwned'); }
    if (paint.sub === 'region' && paint.region != null && paint.plan) { renderRegion(); return showSub('pRegion'); }
    if (paint.sub === 'plan' && paint.plan) { renderPlan(); return showSub('pPlan'); }
    renderSetup(); showSub('pSetup');
  }
  function renderSetup() {
    const grid = $('#mediaGrid'); grid.innerHTML = '';
    for (const [id, m] of Object.entries(LIB.MEDIA)) {
      const b = document.createElement('button'); b.className = 'media'; b.setAttribute('aria-pressed', String(S.medium === id));
      const order = m.family === 'mono' ? 'tones only' : m.opaque ? 'dark → light' : 'light → dark';
      b.innerHTML = `${esc(m.short)}<small>${order}</small>`;
      b.addEventListener('click', () => { S.medium = id; save(); onMediumChange(); });
      grid.append(b);
    }
    const sel = $('#setSelect'), m = LIB.MEDIA[S.medium], cs = curSet();
    sel.innerHTML = m.sets.map((s) => `<option value="${s}" ${s === cs ? 'selected' : ''}>${esc(LIB.SETS[s].name)}</option>`).join('');
    const n = setColours(cs).length;
    $('#setNote').textContent = `${n} colour${n === 1 ? '' : 's'} available${LIB.SETS[cs].approx ? ' · approx. swatches' : ''}`;
    $$('[data-group="detail"] [data-value]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === S.detail)));
    $('#analyseBtn').textContent = paint.analysis ? 'Re-analyse photo' : 'Analyse photo & build plan';
    $('#backToPlanRow').hidden = !paint.plan;
  }
  function onMediumChange() {
    if (paint.analysis) { const p = progress(); paint.layer = p.layer || 0; buildPlan(); renderGuide(); }
    renderSetup(); syncUI();
  }
  function renderPlan() {
    const P = paint.plan, A = paint.analysis; if (!P) return;
    const prog = progress(), done = new Set(prog.done);
    const setId = curSet();
    $('#planMedium').innerHTML = `<b>${esc(P.med.short)}</b> · ${esc(LIB.SETS[setId].name)} <span style="color:var(--muted)">(${P.colourCount})</span>`;
    $$('[data-group="view"] [data-value]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === S.view)));
    const l = P.layers[paint.layer];
    $('#layerNum').textContent = `Layer ${paint.layer + 1} of ${P.layers.length}`;
    $('#layerName').innerHTML = `${done.has(l.key) ? '<span class="done">✓</span> ' : ''}${esc(l.title)}`;
    $('#dots').innerHTML = P.layers.map((x, i) => `<i class="${i === paint.layer ? 'cur' : ''} ${done.has(x.key) ? 'done' : ''}"></i>`).join('');
    $('#layerPrev').disabled = paint.layer === 0; $('#layerNext').disabled = paint.layer === P.layers.length - 1;
    $('#layerPurpose').textContent = l.purpose;
    const unit = P.med.unit;
    $('#appList').innerHTML = (l.apps.length > 1 ? `<button class="app" data-app="-1" aria-pressed="${paint.app == null}" style="padding:9px 11px"><div class="body"><div class="nm">All ${l.apps.length} colours in this layer</div><div class="meta">Tap one colour below to show only where it goes</div></div></button>` : '') +
      l.apps.map((a, i) => {
        const regs = a.regions.map((r) => '#' + (r.id + 1));
        const shown = regs.slice(0, 8).join(' ') + (regs.length > 8 ? ` +${regs.length - 8}` : '');
        const q = a.match && a.match.dE != null && a.kind !== 'reserve' ? ` · est. ΔE ${a.match.dE.toFixed(1)} (${a.match.quality})` : '';
        const sw = a.kind === 'reserve' ? '#ffffff' : a.match.hex;
        return `<button class="app" data-app="${i}" aria-pressed="${paint.app === i}">
          <span class="sw" style="background:${sw}"><i style="background:${a.target}"></i></span>
          <div class="body"><div class="nm">${esc(a.name)}</div>
          <div class="meta">${a.kind === 'reserve' ? esc(a.match.text) : `<b>${esc(a.pressure)}</b> ${esc(unit.toLowerCase())} · ${esc(a.stroke)}`}</div>
          ${a.kind !== 'reserve' ? `<div class="meta">${a.visible != null ? `Leave ~${a.visible}% of the layer below visible · ` : ''}${esc(a.blend)}</div>` : ''}
          ${a.note ? `<div class="meta">${esc(a.note)}</div>` : ''}
          <div class="meta">Where: ${shown}${q}</div>
          ${a.kind !== 'reserve' ? `<div class="bar"><i style="width:${Math.round(a.I * 100)}%"></i></div>` : ''}</div></button>`;
      }).join('');
    const avoid = l.avoid.slice(0, 16).map((id) => '#' + (id + 1)).join(' ');
    $('#layerExtra').innerHTML = (l.avoid.length ? `<p class="hint"><b>Avoid</b> (red hatching): ${avoid}${l.avoid.length > 16 ? ` +${l.avoid.length - 16}` : ''}</p>` : '') +
      (l.tips && l.tips.length ? `<p class="hint">${l.tips.map(esc).join('<br>')}</p>` : '');
    $('#layerDone').textContent = done.has(l.key) ? 'Done ✓ — tap to undo' : paint.layer < P.layers.length - 1 ? 'Mark done & go to next layer' : 'Mark final layer done';
    renderAnalysisBox();
  }
  function renderAnalysisBox() {
    const A = paint.analysis, P = paint.plan; if (!A || !P) return;
    const fam = A.families.slice(0, 8).map((f, i) => `<div class="pal"><i style="background:${f.litHex}"></i><div>${esc(f.name)} · ${Math.round(f.frac * 100)}%<small>${i === 0 ? 'dominant' : i === 1 ? 'secondary' : i === 2 ? 'tertiary' : 'accent'}${f.wheel ? ' · ' + f.wheel.name + ' (' + f.wheel.kind + ' hue)' : ' · neutral'} · ${f.litHex}</small></div></div>`).join('');
    const top = A.regions.slice(0, 10).map((r) => `<div class="pal"><i style="background:${r.hex}"></i><div>#${r.id + 1} · ${Math.round(r.frac * 1000) / 10}%<small>${r.hex} · ${esc(r.tone)}</small></div></div>`).join('');
    $('#analysisBody').innerHTML = `<ul class="ins">${P.insights.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <h3>Colour families</h3><div class="palette">${fam}</div>
      <h3>Largest regions</h3><div class="palette">${top}</div>
      <p class="disclaimer">Light direction, reflected light and form are inferred from shading in the photo’s pixels; flat or busy images give weaker estimates.</p>`;
  }
  function renderRegion() {
    const A = paint.analysis, P = paint.plan, id = paint.region, r = A.regions[id], info = P.regionInfo[id], f = A.families[r.family];
    const rgb = CL.hexToRgb(r.hex), m = info.match, d = info.dec;
    const flags = [];
    if (d.reserve && P.med.reserve) flags.push('<span class="tag">Reserve as paper white</span>');
    if (d.comp) flags.push(`<span class="tag">Complementary underpainting ${Math.round(d.comp.I * 100)}%</span>`);
    if (d.rich) flags.push('<span class="tag">Rich shadow — no complement</span>');
    if (r.reflected) flags.push(`<span class="tag">Reflected light from #${r.reflected.from + 1}</span>`);
    if (r.shadowOf != null) flags.push(`<span class="tag">Shadow side of #${r.shadowOf + 1}</span>`);
    const hard = r.nb.filter((n) => !n.soft).slice(0, 5).map((n) => '#' + (n.id + 1)).join(' ');
    const soft = r.nb.filter((n) => n.soft).slice(0, 5).map((n) => '#' + (n.id + 1)).join(' ');
    const layersHtml = info.layers.length ? info.layers.map((x) => { const l = P.layers[x.li], a = l.apps[x.ai]; return `<button class="app" data-goto="${x.li}" data-goapp="${x.ai}" style="padding:9px 11px"><span class="sw" style="background:${a.kind === 'reserve' ? '#fff' : a.match.hex};width:30px;height:30px"></span><div class="body"><div class="nm" style="font-size:13px">Layer ${x.li + 1} · ${esc(l.title)}</div><div class="meta">${esc(a.name)} · <b>${esc(a.pressure || '')}</b> · intensity ${Math.round(x.I * 100)}%</div></div></button>`; }).join('') : '<p class="hint">Not used in any layer.</p>';
    const form = { flat: 'flat, even colour', curved: 'curved — smooth gradation', textured: 'textured / detailed', subtle: 'subtle variation' }[r.form];
    $('#pRegion').innerHTML = `
      <h3>Region #${id + 1} <button class="link" id="regBack" style="color:var(--accent);font-weight:600;letter-spacing:0;text-transform:none;font-size:13px">Back to plan</button></h3>
      <div style="display:flex;gap:10px;margin-bottom:12px">
        <div style="flex:1"><div style="height:54px;border-radius:12px;background:${r.hex};border:1px solid var(--line2)"></div><div class="meta hint" style="margin:4px 0 0">Photo colour</div></div>
        <div style="flex:1"><div style="height:54px;border-radius:12px;background:${m.hex};border:1px solid var(--line2)"></div><div class="meta hint" style="margin:4px 0 0">Estimated with your set</div></div>
        ${info.complement ? `<div style="flex:1"><div style="height:54px;border-radius:12px;background:${info.complement.hex};border:1px solid var(--line2)"></div><div class="meta hint" style="margin:4px 0 0">Complement</div></div>` : ''}
      </div>
      <div class="kv">
        <span>Colour</span><div>${esc(r.name)} · ${r.hex} · RGB ${rgb.join(', ')}</div>
        <span>CIELAB</span><div>L* ${r.lab[0].toFixed(1)} · a* ${r.lab[1].toFixed(1)} · b* ${r.lab[2].toFixed(1)} · C* ${r.C.toFixed(1)}</div>
        <span>Value</span><div>${esc(r.tone)} (${Math.round(r.t * 100)}% up its family’s range)</div>
        <span>Family</span><div>${esc(f ? f.name : '—')}${f && f.wheel ? ` · ${f.wheel.name}, ${f.wheel.kind} hue` : ''}</div>
        <span>Temperature</span><div>${esc(r.temp)}${r.relTemp !== 'similar' ? ` · ${r.relTemp} than its family` : ''}</div>
        <span>Surface</span><div>${esc(form)}${r.lightSide ? ` · lighter towards ${esc(r.lightSide)}` : ''}</div>
        <span>Recommended</span><div>${esc(m.text)}${m.dE != null ? ` · est. ΔE ${m.dE.toFixed(1)} (${m.quality})` : ''}</div>
        ${info.complement ? `<span>Complement</span><div>${info.complement.hex} → ${esc(info.complement.match.text)}</div>` : ''}
        <span>Max intensity</span><div>${Math.round(info.maxI * 100)}% · ${esc(P.med.pressure[Math.min(4, Math.floor(info.maxI * 5))])}</div>
        <span>Edges</span><div>${hard ? 'hard with ' + hard : ''}${hard && soft ? '; ' : ''}${soft ? 'soft with ' + soft : ''}${!hard && !soft ? '—' : ''}</div>
        <span>Area</span><div>${(r.frac * 100).toFixed(1)}% of the image</div>
      </div>
      <div>${flags.join('')}</div>
      <p class="hint">${esc(d.why || '')}</p>
      <h3>Used in</h3>${layersHtml}
      <p class="disclaimer">Estimates from photo pixels — real pencils and paints vary with paper, pressure and layering.</p>`;
    $('#regBack').addEventListener('click', () => { paint.sub = 'plan'; paint.region = null; renderGuide(); renderPaint(); });
    $$('#pRegion [data-goto]').forEach((b) => b.addEventListener('click', () => { goLayer(+b.dataset.goto); paint.app = +b.dataset.goapp; paint.sub = 'plan'; S.view = 'layer'; syncUI(); renderGuide(); renderPaint(); }));
  }
  function renderOwned() {
    const setId = curSet(), set = LIB.SETS[setId], ex = new Set(S.excluded[setId] || []);
    const list = setId === 'custom' ? S.customColours : set.colours;
    const el = $('#pOwned');
    el.innerHTML = `<h3>My colours <button class="link" id="ownBack" style="color:var(--accent);font-weight:600;letter-spacing:0;text-transform:none;font-size:13px">Done</button></h3>
      <p class="hint"><b>${esc(set.name)}</b> — untick colours you don’t own; plans only use ticked colours.${set.approx ? ' Swatch values are approximate screen renderings; edit or replace them with a custom set for accuracy.' : ''}</p>
      ${setId !== 'custom' ? '<div class="row"><button class="btn" id="ownAll">Select all</button><button class="btn" id="ownNone">Select none</button></div>' : ''}
      ${setId === 'custom' ? '<div class="add-row"><input type="text" id="cName" placeholder="Colour name" maxlength="40"><input type="color" id="cHex" value="#c8553d" aria-label="Colour"><button class="btn primary" id="cAdd" style="flex:none;width:72px">Add</button></div>' : ''}
      <div class="owned-list">${list.map((c, i) => `<label class="own"><i style="background:${c.hex}"></i><span>${esc(c.name)} <small>${esc(c.code || '')} ${c.hex}</small></span>${setId === 'custom' ? `<button class="chip" data-del="${i}">Remove</button>` : `<input type="checkbox" data-code="${esc(c.code)}" ${ex.has(c.code) ? '' : 'checked'}>`}</label>`).join('') || '<p class="hint">No colours yet — add the pencils or paints you own (use a photo of your swatch card and the colour picker).</p>'}</div>`;
    $('#ownBack').addEventListener('click', () => { paint.sub = paint.plan ? 'plan' : 'setup'; if (paint.analysis) { buildPlan(); renderGuide(); } renderPaint(); });
    $$('#pOwned input[type=checkbox]').forEach((cb) => cb.addEventListener('change', () => {
      const s = new Set(S.excluded[setId] || []); if (cb.checked) s.delete(cb.dataset.code); else s.add(cb.dataset.code); S.excluded[setId] = [...s]; save();
    }));
    const all = $('#ownAll'), none = $('#ownNone');
    if (all) all.addEventListener('click', () => { S.excluded[setId] = []; save(); renderOwned(); });
    if (none) none.addEventListener('click', () => { S.excluded[setId] = list.map((c) => c.code); save(); renderOwned(); });
    const add = $('#cAdd');
    if (add) add.addEventListener('click', () => {
      const name = $('#cName').value.trim() || 'Colour ' + (S.customColours.length + 1);
      S.customColours.push({ code: 'C' + Date.now().toString(36).slice(-4), name, hex: $('#cHex').value }); save(); renderOwned();
    });
    $$('#pOwned [data-del]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); S.customColours.splice(+b.dataset.del, 1); save(); renderOwned(); }));
  }
  function goLayer(i) {
    const P = paint.plan; if (!P) return;
    paint.layer = clamp(i, 0, P.layers.length - 1); paint.app = null;
    const p = progress(); p.layer = paint.layer; save();
  }
  function inspectRegion(id) {
    paint.region = id; paint.sub = 'region';
    renderGuide();
    if (curTab !== 'paint') openTab('paint'); else renderPaint();
  }
  function bindPaintUI() {
    $('#analyseBtn').addEventListener('click', runAnalysis);
    $('#backToPlan').addEventListener('click', () => { paint.sub = 'plan'; renderPaint(); });
    $('#changeMedium').addEventListener('click', () => { paint.sub = 'setup'; renderPaint(); });
    $('#ownedBtn').addEventListener('click', () => { paint.sub = 'owned'; renderPaint(); });
    $('#setSelect').addEventListener('change', (e) => { S.setByMedium[S.medium] = e.target.value; save(); if (paint.analysis) { buildPlan(); renderGuide(); } renderSetup(); });
    $('#layerPrev').addEventListener('click', () => { goLayer(paint.layer - 1); ensureLayerView(); });
    $('#layerNext').addEventListener('click', () => { goLayer(paint.layer + 1); ensureLayerView(); });
    $('#layerDone').addEventListener('click', () => {
      const P = paint.plan, l = P.layers[paint.layer], p = progress(), s = new Set(p.done);
      if (s.has(l.key)) s.delete(l.key); else { s.add(l.key); if (paint.layer < P.layers.length - 1) { p.done = [...s]; goLayer(paint.layer + 1); toast(`Nice — on to layer ${paint.layer + 1}`); ensureLayerView(); return; } toast('All layers done — beautiful work'); }
      p.done = [...s]; save(); renderPlan();
    });
    $('#appList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-app]'); if (!b) return;
      const i = +b.dataset.app; paint.app = i < 0 || paint.app === i ? null : i;
      if (S.view !== 'layer') { S.view = 'layer'; syncUI(); }
      renderGuide(); renderPlan();
    });
    $('[data-group="view"]').addEventListener('click', () => setTimeout(renderPlan, 0));
  }
  function ensureLayerView() { if (S.view === 'photo') S.view = 'layer'; syncUI(); renderGuide(); renderPlan(); }

  /* ================= service worker ================= */
  function registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  /* ================= boot ================= */
  bindUI(); syncUI();
  restoreCurrent();
  startCamera();
  registerSW();
  window.__lucida = { S, paint, get img() { return img; }, Cam, renderGuide, regionAt, screenToImage }; // for debugging/tests
})();
