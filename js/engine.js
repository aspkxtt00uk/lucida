/* Lucida — image engine. Runs inside a Web Worker (preferred) or on the main thread as a fallback.
   1) Drawing-assist filters (adjustments, mono, sketch, edges, outline)
   2) Painting analysis: CIELAB conversion, SLIC superpixels, edge-aware region merging,
      tone / temperature / form / light-direction / reflected-light / transition analysis. */
(function () {
  'use strict';
  const IS_WORKER = typeof document === 'undefined' && typeof importScripts === 'function';
  if (IS_WORKER) importScripts('colour.js');
  const CL = self.LucidaColour;

  /* ---------------- shared primitives ---------------- */
  function blurH(s, d, w, h, r) {
    const k = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const o = y * w; let v = s[o] * (r + 1);
      for (let i = 1; i <= r; i++) v += s[o + Math.min(i, w - 1)];
      d[o] = v * k;
      for (let x = 1; x < w; x++) { v += s[o + Math.min(x + r, w - 1)] - s[o + Math.max(x - r - 1, 0)]; d[o + x] = v * k; }
    }
  }
  function blurV(s, d, w, h, r) {
    const k = 1 / (2 * r + 1);
    for (let x = 0; x < w; x++) {
      let v = s[x] * (r + 1);
      for (let i = 1; i <= r; i++) v += s[Math.min(i, h - 1) * w + x];
      d[x] = v * k;
      for (let y = 1; y < h; y++) { v += s[Math.min(y + r, h - 1) * w + x] - s[Math.max(y - r - 1, 0) * w + x]; d[y * w + x] = v * k; }
    }
  }
  function blur(a, w, h, r, passes) {
    if (r < 1) return a;
    let s = Float32Array.from(a); const t = new Float32Array(a.length);
    for (let p = 0; p < (passes || 1); p++) { blurH(s, t, w, h, r); blurV(t, s, w, h, r); }
    return s;
  }
  function sobel(a, w, h, gxOut, gyOut) {
    const m = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      let i = y * w + 1;
      for (let x = 1; x < w - 1; x++, i++) {
        const tl = a[i - w - 1], t = a[i - w], tr = a[i - w + 1], l = a[i - 1], r = a[i + 1], bl = a[i + w - 1], b = a[i + w], br = a[i + w + 1];
        const gx = tr + 2 * r + br - tl - 2 * l - bl, gy = bl + 2 * b + br - tl - 2 * t - tr;
        m[i] = Math.sqrt(gx * gx + gy * gy);
        if (gxOut) { gxOut[i] = gx; gyOut[i] = gy; }
      }
    }
    return m;
  }
  function dilate(a, w, h, r) {
    if (r < 1) return a;
    const t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0; for (let k = -r; k <= r; k++) { const v = a[y * w + Math.min(w - 1, Math.max(0, x + k))]; if (v > m) m = v; } t[y * w + x] = m;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let m = 0; for (let k = -r; k <= r; k++) { const v = t[Math.min(h - 1, Math.max(0, y + k)) * w + x]; if (v > m) m = v; } o[y * w + x] = m;
    }
    return o;
  }

  /* ---------------- 1) drawing-assist filters ---------------- */
  let src = null, W = 0, H = 0;
  function setSrc(buf, w, h) { src = new Uint8ClampedArray(buf); W = w; H = h; }
  function lut(b, c) {
    const t = new Float32Array(256), C = c * 2.55, k = (259 * (C + 255)) / (255 * (259 - C));
    for (let i = 0; i < 256; i++) { let v = i + b * 2.55; v = k * (v - 128) + 128; t[i] = v < 0 ? 0 : v > 255 ? 255 : v; }
    return t;
  }
  function adjust(p) {
    const n = W * H, out = new Uint8ClampedArray(n * 4), L = lut(p.brightness, p.contrast), s = p.saturation / 100;
    for (let i = 0, j = 0; j < n; j++, i += 4) {
      let r = L[src[i]], g = L[src[i + 1]], b = L[src[i + 2]];
      if (s !== 1) { const y = 0.299 * r + 0.587 * g + 0.114 * b; r = y + (r - y) * s; g = y + (g - y) * s; b = y + (b - y) * s; }
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = src[i + 3];
    }
    return out;
  }
  function process(p) {
    const adj = adjust(p);
    if (p.mode === 'original') return adj;
    const n = W * H, out = new Uint8ClampedArray(n * 4), g = new Float32Array(n);
    for (let i = 0, j = 0; j < n; j++, i += 4) g[j] = 0.299 * adj[i] + 0.587 * adj[i + 1] + 0.114 * adj[i + 2];
    const scaleR = (v) => Math.max(1, Math.round((v * Math.max(W, H)) / 1000));
    if (p.mode === 'mono') {
      for (let i = 0, j = 0; j < n; j++, i += 4) { out[i] = out[i + 1] = out[i + 2] = g[j]; out[i + 3] = adj[i + 3]; }
    } else if (p.mode === 'sketch') {
      const inv = new Float32Array(n); for (let j = 0; j < n; j++) inv[j] = 255 - g[j];
      const bl = blur(inv, W, H, scaleR(p.softness * 1.5), 2), gam = 1 + (p.depth - 1) * 0.45;
      for (let i = 0, j = 0; j < n; j++, i += 4) {
        const d = bl[j]; let v = d >= 254.5 ? 255 : (g[j] * 255) / (255 - d); if (v > 255) v = 255;
        v = 255 * Math.pow(v / 255, gam);
        out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = adj[i + 3];
      }
    } else {
      const sm = p.smoothing > 0 ? blur(g, W, H, Math.max(1, Math.round((p.smoothing * Math.max(W, H)) / 1600)), 1) : g;
      const m = sobel(sm, W, H);
      if (p.mode === 'edges') {
        const gain = (p.strength / 5) * 0.9;
        for (let i = 0, j = 0; j < n; j++, i += 4) { const v = 255 - Math.min(255, m[j] * gain); out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255; }
      } else {
        const thr = 18 + (100 - p.sensitivity) * 3.2, soft = thr * 0.6;
        let a = new Float32Array(n);
        for (let j = 0; j < n; j++) { const v = (m[j] - thr) / soft; a[j] = v <= 0 ? 0 : v >= 1 ? 1 : v; }
        const rad = Math.round(((p.weight - 1) * Math.max(W, H)) / 1200);
        a = dilate(a, W, H, rad);
        const [r, gg, b] = p.lineRGB;
        for (let i = 0, j = 0; j < n; j++, i += 4) { out[i] = r; out[i + 1] = gg; out[i + 2] = b; out[i + 3] = a[j] * 255; }
      }
    }
    return out;
  }

  /* ---------------- 2) painting analysis ---------------- */
  const DETAIL = {
    simple: { ares: 340, K: 230, T: 15, maxR: 36, minFrac: 0.004 },
    balanced: { ares: 420, K: 430, T: 10.5, maxR: 72, minFrac: 0.002 },
    detailed: { ares: 520, K: 760, T: 7.5, maxR: 130, minFrac: 0.0009 },
  };
  const fl = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  function percentile(sortedOrHist, q) { return sortedOrHist(q); }
  const RAD = Math.PI / 180;

  function analyze(rgba, w, h, detail, progress) {
    const cfg = DETAIL[detail] || DETAIL.balanced;
    const N = w * h, lin = CL.LIN;
    progress(0.03, 'Converting pixels to CIELAB');
    const L = new Float32Array(N), A = new Float32Array(N), B = new Float32Array(N);
    for (let i = 0, j = 0; j < N; j++, i += 4) {
      const al = rgba[i + 3] / 255;
      let r = lin[rgba[i]], g = lin[rgba[i + 1]], b = lin[rgba[i + 2]];
      if (al < 1) { r = r * al + 1 - al; g = g * al + 1 - al; b = b * al + 1 - al; }
      const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b, z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
      const fx = fl(x), fy = fl(y), fz = fl(z);
      L[j] = 116 * fy - 16; A[j] = 500 * (fx - fy); B[j] = 200 * (fy - fz);
    }
    const Ls = blur(L, w, h, 1, 1), As = blur(A, w, h, 1, 1), Bs = blur(B, w, h, 1, 1);

    /* analysis resolution */
    const sf = Math.min(1, cfg.ares / Math.max(w, h));
    const aw = Math.max(8, Math.round(w * sf)), ah = Math.max(8, Math.round(h * sf)), AN = aw * ah;
    let aL = new Float32Array(AN), aA = new Float32Array(AN), aB = new Float32Array(AN);
    const cnt = new Float32Array(AN);
    const cellOf = new Int32Array(N);
    for (let y = 0; y < h; y++) {
      const ay = Math.min(ah - 1, ((y + 0.5) * ah / h) | 0);
      for (let x = 0; x < w; x++) {
        const ax = Math.min(aw - 1, ((x + 0.5) * aw / w) | 0), k = ay * aw + ax, j = y * w + x;
        cellOf[j] = k; aL[k] += L[j]; aA[k] += A[j]; aB[k] += B[j]; cnt[k]++;
      }
    }
    for (let k = 0; k < AN; k++) { const c = cnt[k] || 1; aL[k] /= c; aA[k] /= c; aB[k] /= c; }
    aL = blur(aL, aw, ah, 1, 1); aA = blur(aA, aw, ah, 1, 1); aB = blur(aB, aw, ah, 1, 1);
    const agrad = sobel(aL, aw, ah);

    /* SLIC superpixels (Achanta et al. 2012) on CIELAB */
    progress(0.12, 'Segmenting into superpixels (SLIC)');
    const S = Math.max(4, Math.sqrt(AN / cfg.K)), mC = 10, wxy = (mC * mC) / (S * S);
    const cx = [], cy = [];
    for (let y = S / 2; y < ah; y += S) for (let x = S / 2; x < aw; x += S) {
      let bx = Math.round(x), by = Math.round(y), best = Infinity, px = bx, py = by;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = bx + dx, yy = by + dy; if (xx < 0 || yy < 0 || xx >= aw || yy >= ah) continue;
        const gv = agrad[yy * aw + xx]; if (gv < best) { best = gv; px = xx; py = yy; }
      }
      cx.push(px); cy.push(py);
    }
    const nc = cx.length;
    const cL = new Float32Array(nc), cA = new Float32Array(nc), cB = new Float32Array(nc), cX = Float32Array.from(cx), cY = Float32Array.from(cy);
    for (let c = 0; c < nc; c++) { const k = cy[c] * aw + cx[c]; cL[c] = aL[k]; cA[c] = aA[k]; cB[c] = aB[k]; }
    const sp = new Int32Array(AN).fill(-1), dist = new Float32Array(AN);
    const sums = new Float64Array(nc * 6);
    for (let it = 0; it < 8; it++) {
      dist.fill(Infinity);
      for (let c = 0; c < nc; c++) {
        const x0 = Math.max(0, Math.floor(cX[c] - S)), x1 = Math.min(aw - 1, Math.ceil(cX[c] + S));
        const y0 = Math.max(0, Math.floor(cY[c] - S)), y1 = Math.min(ah - 1, Math.ceil(cY[c] + S));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const k = y * aw + x, dl = aL[k] - cL[c], da = aA[k] - cA[c], db = aB[k] - cB[c], dx = x - cX[c], dy = y - cY[c];
          const D = dl * dl + da * da + db * db + (dx * dx + dy * dy) * wxy;
          if (D < dist[k]) { dist[k] = D; sp[k] = c; }
        }
      }
      sums.fill(0);
      for (let k = 0; k < AN; k++) { const c = sp[k]; if (c < 0) continue; const o = c * 6; sums[o] += aL[k]; sums[o + 1] += aA[k]; sums[o + 2] += aB[k]; sums[o + 3] += k % aw; sums[o + 4] += (k / aw) | 0; sums[o + 5]++; }
      for (let c = 0; c < nc; c++) { const o = c * 6, n = sums[o + 5]; if (!n) continue; cL[c] = sums[o] / n; cA[c] = sums[o + 1] / n; cB[c] = sums[o + 2] / n; cX[c] = sums[o + 3] / n; cY[c] = sums[o + 4] / n; }
      progress(0.12 + 0.13 * (it + 1) / 8, 'Segmenting into superpixels (SLIC)');
    }
    /* enforce connectivity */
    const lab = new Int32Array(AN).fill(-1), stack = new Int32Array(AN), members = new Int32Array(AN);
    const minSeg = Math.max(4, ((S * S) / 4) | 0);
    let nsp = 0;
    for (let k = 0; k < AN; k++) {
      if (lab[k] >= 0) continue;
      const x = k % aw; let adj = -1;
      if (x > 0 && lab[k - 1] >= 0) adj = lab[k - 1]; else if (k >= aw && lab[k - aw] >= 0) adj = lab[k - aw];
      const target = sp[k]; let top = 0, size = 0;
      stack[top++] = k; lab[k] = nsp;
      while (top) {
        const p = stack[--top]; members[size++] = p;
        const px = p % aw;
        const nb = [px > 0 ? p - 1 : -1, px < aw - 1 ? p + 1 : -1, p >= aw ? p - aw : -1, p + aw < AN ? p + aw : -1];
        for (const q of nb) if (q >= 0 && lab[q] < 0 && sp[q] === target) { lab[q] = nsp; stack[top++] = q; }
      }
      if (size < minSeg && adj >= 0) { for (let i = 0; i < size; i++) lab[members[i]] = adj; } else nsp++;
    }

    /* region adjacency graph with edge strength */
    progress(0.3, 'Merging superpixels into colour regions');
    const sortedG = Float32Array.from(agrad).sort();
    const magRef = Math.max(8, sortedG[Math.floor(sortedG.length * 0.9)]);
    const reg = new Array(nsp);
    for (let i = 0; i < nsp; i++) reg[i] = { id: i, alive: true, n: 0, sL: 0, sA: 0, sB: 0, nb: new Map() };
    for (let k = 0; k < AN; k++) { const r = reg[lab[k]]; r.n++; r.sL += aL[k]; r.sA += aA[k]; r.sB += aB[k]; }
    const addEdge = (a, b, g) => {
      let e = reg[a].nb.get(b);
      if (!e) { e = { s: 0, n: 0 }; reg[a].nb.set(b, e); reg[b].nb.set(a, e); }
      e.s += g; e.n++;
    };
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const k = y * aw + x, a = lab[k];
      if (x + 1 < aw && lab[k + 1] !== a) addEdge(a, lab[k + 1], (agrad[k] + agrad[k + 1]) / 2);
      if (y + 1 < ah && lab[k + aw] !== a) addEdge(a, lab[k + aw], (agrad[k] + agrad[k + aw]) / 2);
    }
    const minArea = AN * cfg.minFrac;
    const cost = (ra, rb, e) => {
      const dl = ra.sL / ra.n - rb.sL / rb.n, da = ra.sA / ra.n - rb.sA / rb.n, db = ra.sB / ra.n - rb.sB / rb.n;
      const dE = Math.sqrt(1.3 * dl * dl + da * da + db * db); // value differences weigh a little more (painters think in values)
      // edge strength only protects boundaries between genuinely different colours
      let c = dE * (1 + 0.9 * Math.min(2.5, e.s / e.n / magRef) * Math.min(1, dE / 8));
      const small = Math.min(ra.n, rb.n);
      if (small < minArea) c *= 0.25 + (0.75 * small) / minArea;
      return c;
    };
    const parent = new Int32Array(nsp); for (let i = 0; i < nsp; i++) parent[i] = i;
    const merge = (a, b) => { // b into a
      const ra = reg[a], rb = reg[b];
      for (const [c, e] of rb.nb) {
        if (c === a) continue;
        const rc = reg[c]; rc.nb.delete(b);
        const ea = ra.nb.get(c);
        if (ea) { ea.s += e.s; ea.n += e.n; } else { const ne = { s: e.s, n: e.n }; ra.nb.set(c, ne); rc.nb.set(a, ne); }
      }
      ra.nb.delete(b); ra.n += rb.n; ra.sL += rb.sL; ra.sA += rb.sA; ra.sB += rb.sB; rb.alive = false; rb.nb = new Map(); parent[b] = a;
    };
    let alive = nsp, iter = 0;
    while (alive > 1) {
      let best = Infinity, ba = -1, bb = -1;
      for (const r of reg) {
        if (!r.alive) continue;
        for (const [c, e] of r.nb) { if (c < r.id) continue; const v = cost(r, reg[c], e); if (v < best) { best = v; ba = r.id; bb = c; } }
      }
      if (ba < 0) break;
      if (best > cfg.T && alive <= cfg.maxR) break;
      if (reg[ba].n >= reg[bb].n) merge(ba, bb); else merge(bb, ba);
      alive--;
      if (++iter % 40 === 0) progress(0.3 + 0.2 * Math.min(1, iter / nsp), 'Merging superpixels into colour regions');
    }
    // absorb leftover tiny regions — and regions that are perceptually identical to a neighbour
    const nearTwin = (r) => { for (const [c] of r.nb) { const o = reg[c]; if (Math.hypot(r.sL / r.n - o.sL / o.n, r.sA / r.n - o.sA / o.n, r.sB / r.n - o.sB / o.n) < 3.5) return true; } return false; };
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (const r of reg) {
        if (!r.alive || !r.nb.size || (r.n >= minArea && !nearTwin(r))) continue;
        let best = Infinity, bt = -1;
        for (const [c] of r.nb) { const o = reg[c]; const d = Math.hypot(r.sL / r.n - o.sL / o.n, r.sA / r.n - o.sA / o.n, r.sB / r.n - o.sB / o.n); if (d < best) { best = d; bt = c; } }
        if (bt >= 0) { merge(bt, r.id); changed = true; }
      }
      if (!changed) break;
    }
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const roots = new Map(); const rootIds = [];
    for (let i = 0; i < nsp; i++) { const r = find(i); if (!roots.has(r)) { roots.set(r, rootIds.length); rootIds.push(r); } }
    const RN = rootIds.length;
    const rl = new Int32Array(AN); for (let k = 0; k < AN; k++) rl[k] = roots.get(find(lab[k]));
    const rMean = new Float32Array(RN * 3);
    rootIds.forEach((r, i) => { const o = reg[r]; rMean[i * 3] = o.sL / o.n; rMean[i * 3 + 1] = o.sA / o.n; rMean[i * 3 + 2] = o.sB / o.n; });

    /* full-resolution labels with edge-following boundary refinement */
    progress(0.55, 'Refining region boundaries');
    const bnd = new Uint8Array(AN);
    for (let y = 0; y < ah; y++) for (let x = 0; x < aw; x++) {
      const k = y * aw + x, v = rl[k];
      for (let dy = -1; dy <= 1 && !bnd[k]; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= aw || yy >= ah) continue;
        if (rl[yy * aw + xx] !== v) { bnd[k] = 1; break; }
      }
    }
    let labels = new Uint16Array(N);
    const cand = new Int32Array(9);
    for (let j = 0; j < N; j++) {
      const k = cellOf[j], base = rl[k];
      if (!bnd[k]) { labels[j] = base; continue; }
      const ax = k % aw, ay = (k / aw) | 0; let nCand = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = ax + dx, yy = ay + dy; if (xx < 0 || yy < 0 || xx >= aw || yy >= ah) continue;
        const v = rl[yy * aw + xx]; let dup = false; for (let q = 0; q < nCand; q++) if (cand[q] === v) { dup = true; break; }
        if (!dup) cand[nCand++] = v;
      }
      let best = Infinity, bl = base;
      for (let q = 0; q < nCand; q++) {
        const c = cand[q], o = c * 3, dl = Ls[j] - rMean[o], da = As[j] - rMean[o + 1], db = Bs[j] - rMean[o + 2];
        const d = dl * dl + da * da + db * db + (c === base ? 0 : 16);
        if (d < best) { best = d; bl = c; }
      }
      labels[j] = bl;
    }
    // 3x3 majority filter on boundary zones to remove speckle
    const lab2 = labels.slice();
    const counts = new Map();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const j = y * w + x; if (!bnd[cellOf[j]]) continue;
      counts.clear(); let bestL = labels[j], bestC = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const v = labels[j + dy * w + dx], c = (counts.get(v) || 0) + 1; counts.set(v, c); if (c > bestC) { bestC = c; bestL = v; }
      }
      if (bestC >= 5) lab2[j] = bestL;
    }
    labels = lab2;

    /* region statistics at full resolution */
    progress(0.68, 'Measuring regions');
    const st = new Float64Array(RN * 14); // n,L,A,B,L2,x,y,xx,yy,xy,xL,yL,minx..(bbox separate)
    const bb = new Int32Array(RN * 4); for (let i = 0; i < RN; i++) { bb[i * 4] = w; bb[i * 4 + 1] = h; bb[i * 4 + 2] = -1; bb[i * 4 + 3] = -1; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = y * w + x, r = labels[j], o = r * 14, l = L[j];
      st[o]++; st[o + 1] += l; st[o + 2] += A[j]; st[o + 3] += B[j]; st[o + 4] += l * l; st[o + 5] += x; st[o + 6] += y;
      st[o + 7] += x * x; st[o + 8] += y * y; st[o + 9] += x * y; st[o + 10] += x * l; st[o + 11] += y * l;
      const q = r * 4; if (x < bb[q]) bb[q] = x; if (y < bb[q + 1]) bb[q + 1] = y; if (x > bb[q + 2]) bb[q + 2] = x; if (y > bb[q + 3]) bb[q + 3] = y;
    }
    const maxDim = Math.max(w, h);
    let regions = [];
    for (let i = 0; i < RN; i++) {
      const o = i * 14, n = st[o]; if (!n) continue;
      const mL = st[o + 1] / n, mA = st[o + 2] / n, mB = st[o + 3] / n, mx = st[o + 5] / n, my = st[o + 6] / n;
      const varL = Math.max(0, st[o + 4] / n - mL * mL);
      const Sxx = st[o + 7] - n * mx * mx, Syy = st[o + 8] - n * my * my, Sxy = st[o + 9] - n * mx * my;
      const SxL = st[o + 10] - n * mx * mL, SyL = st[o + 11] - n * my * mL, SSt = varL * n;
      const det = Sxx * Syy - Sxy * Sxy;
      let bx = 0, by = 0, r2 = 0;
      if (det > 1e-6 && n > 30) { bx = (Syy * SxL - Sxy * SyL) / det; by = (Sxx * SyL - Sxy * SxL) / det; r2 = SSt > 1e-6 ? Math.max(0, Math.min(1, (bx * SxL + by * SyL) / SSt)) : 0; }
      const std = Math.sqrt(varL);
      const slopeMag = Math.hypot(bx, by) * maxDim;
      const form = std < 2.5 ? 'flat' : r2 > 0.35 && slopeMag > 8 ? 'curved' : std > 7 ? 'textured' : 'subtle';
      regions.push({ old: i, area: n, frac: n / N, cx: mx / w, cy: my / h, bbox: [bb[i * 4] / w, bb[i * 4 + 1] / h, bb[i * 4 + 2] / w, bb[i * 4 + 3] / h],
        lab: [mL, mA, mB], std, slope: [bx * maxDim, by * maxDim], r2, form });
    }
    regions.sort((a, b) => b.area - a.area);
    const remap = new Uint16Array(RN); regions.forEach((r, i) => { r.id = i; remap[r.old] = i; delete r.old; });
    for (let j = 0; j < N; j++) labels[j] = remap[labels[j]];
    const R = regions.length;
    regions.forEach((r) => { r.hex = CL.labToHex(r.lab); const lc = CL.lch(r.lab); r.C = lc[1]; r.h = lc[2]; r.name = CL.describe(r.lab); });

    /* adjacency, edge strength, transitions */
    progress(0.76, 'Analysing edges and transitions');
    const gx = new Float32Array(N), gy = new Float32Array(N);
    const gmag = sobel(Ls, w, h, gx, gy);
    const sample = []; for (let j = 0; j < N; j += 7) sample.push(gmag[j]); sample.sort((a, b) => a - b);
    const gRef = Math.max(6, sample[Math.floor(sample.length * 0.75)]);
    const adj = new Map();
    const addA = (a, b, g) => { if (a > b) { const t = a; a = b; b = t; } const key = a * R + b; let e = adj.get(key); if (!e) { e = { a, b, len: 0, g: 0 }; adj.set(key, e); } e.len++; e.g += g; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = y * w + x, a = labels[j];
      if (x + 1 < w && labels[j + 1] !== a) addA(a, labels[j + 1], (gmag[j] + gmag[j + 1]) / 2);
      if (y + 1 < h && labels[j + w] !== a) addA(a, labels[j + w], (gmag[j] + gmag[j + w]) / 2);
    }
    regions.forEach((r) => { r.nb = []; });
    const pairs = [];
    for (const e of adj.values()) {
      if (e.len < 3) continue;
      const ra = regions[e.a], rb = regions[e.b], dE = CL.dE00(ra.lab, rb.lab), edge = e.g / e.len / gRef;
      // sharpness ≈ boundary gradient relative to the size of the colour step (≈1 crisp, ≪1 blurred/gradual)
      const step = Math.max(Math.abs(ra.lab[0] - rb.lab[0]), 0.5 * Math.hypot(ra.lab[0] - rb.lab[0], ra.lab[1] - rb.lab[1], ra.lab[2] - rb.lab[2]), 2);
      const sharp = e.g / e.len / (4 * step);
      const soft = dE < 5 || sharp < 0.32;
      const p = { a: e.a, b: e.b, len: e.len, edge, dE, soft, sharp };
      pairs.push(p);
      ra.nb.push({ id: e.b, len: e.len, dE, edge, soft, sharp }); rb.nb.push({ id: e.a, len: e.len, dE, edge, soft, sharp });
    }
    regions.forEach((r) => r.nb.sort((a, b) => b.len - a.len));
    const pairType = new Map(); for (const p of pairs) pairType.set(p.a * R + p.b, p.soft ? 1 : 2);
    const bmask = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = y * w + x, a = labels[j];
      const chk = (q) => { const b = labels[q]; if (b === a) return; const t = pairType.get(a < b ? a * R + b : b * R + a) || 1; if (t > bmask[j]) bmask[j] = t; if (t === 2 && bmask[q] < 2) bmask[q] = 2; };
      if (x + 1 < w) chk(j + 1); if (y + 1 < h) chk(j + w);
    }

    /* global tonal distribution */
    progress(0.82, 'Classifying tones and temperature');
    const hist = new Float64Array(201);
    for (let j = 0; j < N; j++) hist[Math.max(0, Math.min(200, Math.round(L[j] * 2)))]++;
    const pct = (q) => { let acc = 0, t = q * N; for (let i = 0; i <= 200; i++) { acc += hist[i]; if (acc >= t) return i / 2; } return 100; };
    const tones = { p03: pct(0.03), p10: pct(0.1), p30: pct(0.3), p50: pct(0.5), p70: pct(0.7), p90: pct(0.9), p97: pct(0.97) };
    const span = Math.max(20, tones.p97 - tones.p03);
    regions.forEach((r) => {
      const l = r.lab[0], v = (l - tones.p03) / span;
      r.v = Math.max(0, Math.min(1, v));
      r.tone = v < 0.15 || l < 18 ? 'deep shadow' : v < 0.38 ? 'shadow' : v < 0.66 ? 'midtone' : 'light';
      // highlight = very light AND a local peak: clearly lighter than its surroundings (not just a light area)
      let nbL = 0, nbW = 0; for (const n of r.nb) { nbL += regions[n.id].lab[0] * n.len; nbW += n.len; }
      const peak = nbW ? l - nbL / nbW : 0;
      // ...and not merely a fragment of a larger, equally light surface of the same colour
      const twin = () => regions.some((o) => o !== r && o.area > r.area * 3 && o.lab[0] >= l - 1.5 && CL.dE00(o.lab, r.lab) < 7);
      if (((l >= 90 && r.C < 10 && peak > -2) || (v >= 0.8 && l >= 68 && r.frac < 0.03 && peak >= 5)) && !twin()) r.tone = 'highlight';
      // warm/cool on the painter's axis: reds-oranges-yellows warm, greens-blues-violets cool
      r.warmth = r.C * Math.cos((r.h - 40) * RAD);
      const hh = r.h;
      r.temp = r.C < 6 ? 'neutral' : hh >= 330 || hh < 110 ? 'warm' : hh >= 130 && hh < 300 ? 'cool' : 'neutral';
    });

    /* colour families: peaks of the area×chroma-weighted hue histogram (no chaining across the wheel) */
    const chroma = regions.filter((r) => r.C >= 11);
    const families = [];
    if (chroma.length) {
      const bins = new Float64Array(36);
      for (const r of chroma) bins[Math.floor(r.h / 10) % 36] += r.area * Math.min(r.C, 40) / 40;
      const sm = new Float64Array(36), K = [1, 2, 3, 2, 1];
      for (let i = 0; i < 36; i++) for (let k = -2; k <= 2; k++) sm[i] += bins[(i + k + 36) % 36] * K[k + 2];
      const tot = sm.reduce((a, b) => a + b, 0) || 1;
      let peaks = [];
      for (let i = 0; i < 36; i++) {
        let isPeak = sm[i] > 0.03 * tot;
        for (let k = 1; k <= 2 && isPeak; k++) if (sm[(i + k) % 36] > sm[i] || sm[(i - k + 36) % 36] > sm[i]) isPeak = false;
        if (isPeak) peaks.push(i * 10 + 5);
      }
      if (!peaks.length) { let mi = 0; for (let i = 1; i < 36; i++) if (sm[i] > sm[mi]) mi = i; peaks = [mi * 10 + 5]; }
      const hd = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
      // refine each peak to the weighted circular mean of nearby regions, then merge close peaks
      peaks = peaks.map((p) => { let x = 0, y = 0; for (const r of chroma) if (hd(r.h, p) < 25) { const w = r.area * Math.min(r.C, 40); x += Math.cos(r.h * RAD) * w; y += Math.sin(r.h * RAD) * w; } return x || y ? (Math.atan2(y, x) / RAD + 360) % 360 : p; });
      peaks.sort((a, b) => a - b);
      const merged = [];
      for (const p of peaks) { if (merged.length && hd(merged[merged.length - 1], p) < 30) continue; merged.push(p); }
      if (merged.length > 1 && hd(merged[0], merged[merged.length - 1]) < 30) merged.pop();
      const groups = merged.map(() => []);
      for (const r of chroma) { let bi = 0, bd = 999; merged.forEach((p, i) => { const d = hd(r.h, p); if (d < bd) { bd = d; bi = i; } }); groups[bi].push(r); }
      groups.filter((g) => g.length).forEach((g) => families.push(g));
    }
    const neutrals = regions.filter((r) => r.C < 11);
    const famObjs = families.map((rs) => ({ neutral: false, rs }));
    if (neutrals.length) famObjs.push({ neutral: true, rs: neutrals });
    famObjs.forEach((f, fi) => {
      const area = f.rs.reduce((s, r) => s + r.area, 0);
      const byL = f.rs.slice().sort((a, b) => b.lab[0] - a.lab[0]);
      let acc = 0, lit = [0, 0, 0], la = 0;
      for (const r of byL) { if (r.tone === 'highlight' && byL.length > 1 && r.C < 12) continue; lit[0] += r.lab[0] * r.area; lit[1] += r.lab[1] * r.area; lit[2] += r.lab[2] * r.area; la += r.area; acc += r.area; if (acc >= area * 0.35) break; }
      if (!la) { const r = byL[0]; lit = r.lab.slice(); la = 1; } else lit = lit.map((v) => v / la);
      const asc = byL.slice().reverse(); let a2 = 0, minL = asc[0].lab[0], maxL = byL[0].lab[0];
      for (const r of asc) { a2 += r.area; if (a2 >= area * 0.05) { minL = r.lab[0]; break; } }
      a2 = 0; for (const r of byL) { a2 += r.area; if (a2 >= area * 0.05) { maxL = r.lab[0]; break; } }
      if (maxL - minL < 6) { minL -= 3; maxL += 3; }
      const meanWarm = f.rs.reduce((s, r) => s + r.warmth * r.area, 0) / area;
      f.id = fi; f.area = area; f.frac = area / N; f.lit = lit; f.litHex = CL.labToHex(lit); f.litC = CL.lch(lit)[1];
      f.minL = minL; f.maxL = maxL; f.meanWarm = meanWarm; f.name = f.neutral ? CL.describe(lit) : CL.describe(lit, true);
      f.wheel = f.neutral ? null : CL.wheelPosition(lit);
      f.rs.forEach((r) => {
        r.family = fi;
        r.t = Math.max(0, Math.min(1, (r.lab[0] - minL) / (maxL - minL)));
        const dw = r.warmth - meanWarm; r.relTemp = dw > 4 ? 'warmer' : dw < -4 ? 'cooler' : 'similar';
      });
    });
    famObjs.sort((a, b) => b.area - a.area);
    const famRemap = new Map(); famObjs.forEach((f, i) => { famRemap.set(f.id, i); f.id = i; });
    regions.forEach((r) => { r.family = famRemap.get(r.family); });
    const fams = famObjs.map((f) => ({ id: f.id, neutral: f.neutral, name: f.name, area: f.area, frac: f.frac, lit: f.lit, litHex: f.litHex, litC: f.litC, minL: f.minL, maxL: f.maxL, wheel: f.wheel, regions: f.rs.map((r) => r.id) }));

    /* light direction (from smooth shading within regions) */
    progress(0.9, 'Estimating light direction');
    let vx = 0, vy = 0, wsum = 0;
    for (const r of regions) {
      const m = Math.hypot(r.slope[0], r.slope[1]);
      if (r.frac < 0.003 || r.r2 < 0.15 || m < 6) continue;
      const wt = r.area * r.r2 * Math.min(1, m / 30);
      vx += (r.slope[0] / m) * wt; vy += (r.slope[1] / m) * wt; wsum += wt;
    }
    let pv = 0, px = 0, py = 0, pw = 0; // pixel-gradient fallback (interior pixels only)
    for (let y = 2; y < h - 2; y += 2) for (let x = 2; x < w - 2; x += 2) {
      const j = y * w + x, a = labels[j];
      if (labels[j - 2] !== a || labels[j + 2] !== a || labels[j - 2 * w] !== a || labels[j + 2 * w] !== a) continue;
      const m = gmag[j]; if (m < gRef * 0.15 || m > gRef * 2.5) continue;
      px += gx[j]; py += gy[j]; pw += m; pv++;
    }
    let light;
    const regConf = wsum > 0 ? Math.hypot(vx, vy) / wsum : 0, pixConf = pw > 0 ? Math.hypot(px, py) / pw : 0;
    const useReg = wsum > N * 0.02 && regConf >= pixConf * 0.8;
    const lvx = useReg ? vx : px, lvy = useReg ? vy : py, conf = useReg ? regConf : pixConf;
    const angle = Math.atan2(lvy, lvx) / RAD;
    const dirs = ['the right', 'the lower right', 'below', 'the lower left', 'the left', 'the upper left', 'above', 'the upper right'];
    const dirName = dirs[(Math.round(((angle + 360) % 360) / 45)) % 8];
    light = { angle, confidence: conf, dir: dirName, vec: [Math.cos(angle * RAD), Math.sin(angle * RAD)], reliable: conf >= 0.18 };

    /* form shadows, reflected light, overlaps */
    progress(0.95, 'Finding shadows and reflected light');
    for (const r of regions) {
      r.lightSide = Math.hypot(r.slope[0], r.slope[1]) > 6 ? dirs[(Math.round(((Math.atan2(r.slope[1], r.slope[0]) / RAD + 360) % 360) / 45)) % 8] : null;
      if (r.tone === 'shadow' || r.tone === 'deep shadow') {
        const lit = r.nb.find((n) => { const o = regions[n.id]; return o.family === r.family && o.lab[0] > r.lab[0] + 15; });
        if (lit) r.shadowOf = lit.id;
      }
      if (light.reliable && (r.tone === 'shadow' || r.tone === 'midtone')) {
        for (const n of r.nb) {
          const core = regions[n.id];
          if (core.family !== r.family || core.lab[0] > r.lab[0] - 5 || (core.tone !== 'shadow' && core.tone !== 'deep shadow')) continue;
          const dx = (r.cx - core.cx) * w, dy = (r.cy - core.cy) * h, dl = Math.hypot(dx, dy) || 1;
          if ((dx * light.vec[0] + dy * light.vec[1]) / dl > -0.25) continue;
          const src = r.nb.find((m) => m.id !== core.id && regions[m.id].lab[0] > r.lab[0] + 5 && (regions[m.id].family !== r.family || regions[m.id].tone === 'light' || regions[m.id].tone === 'highlight'));
          if (src) { r.reflected = { core: core.id, from: src.id }; break; }
        }
      }
    }
    const overlaps = pairs.filter((p) => !p.soft && regions[p.a].family !== regions[p.b].family && p.len > Math.sqrt(N) * 0.15).length;
    const softCount = pairs.filter((p) => p.soft).length;
    progress(1, 'Done');
    return {
      version: 1, w, h, labels, bmask, regions, families: fams, tones, light,
      stats: { regions: R, superpixels: nsp, pairs: pairs.length, soft: softCount, hard: pairs.length - softCount, overlaps, contrast: tones.p97 - tones.p03 },
    };
  }

  const Engine = { setSrc, process, analyze };
  if (IS_WORKER) {
    self.onmessage = (e) => {
      const d = e.data;
      try {
        if (d.type === 'src') setSrc(d.buffer, d.w, d.h);
        else if (d.type === 'process') { const out = process(d.params); self.postMessage({ type: 'result', id: d.id, v: d.v, w: d.w, h: d.h, buffer: out.buffer }, [out.buffer]); }
        else if (d.type === 'analyze') {
          let last = 0;
          const res = analyze(new Uint8ClampedArray(d.buffer), d.w, d.h, d.detail, (p, msg) => { const now = Date.now(); if (now - last > 80 || p >= 1) { last = now; self.postMessage({ type: 'progress', id: d.id, p, msg }); } });
          self.postMessage({ type: 'analysis', id: d.id, result: res }, [res.labels.buffer, res.bmask.buffer]);
        }
      } catch (err) { self.postMessage({ type: 'error', id: d.id, message: String((err && err.message) || err) }); }
    };
  } else self.LucidaEngine = Engine;
})();
