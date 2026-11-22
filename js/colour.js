/* Lucida — colour science helpers (shared by the page and the worker).
   sRGB (D65) <-> linear <-> XYZ <-> CIELAB, CIEDE2000, LCh, artist (RYB) complements,
   and simple optical / pigment mixing estimates. */
(function (root) {
  'use strict';
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const toLin = (c) => { c = Math.max(0, Math.min(255, c)) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const fromLinRaw = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055) * 255;
  const fromLin = (v) => Math.max(0, Math.min(255, Math.round(fromLinRaw(v))));
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const finv = (t) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
  const RAD = Math.PI / 180;

  function linToLab(r, g, b) {
    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function rgbToLab(rgb) { return linToLab(toLin(rgb[0]), toLin(rgb[1]), toLin(rgb[2])); }
  function labToLinRaw(lab) {
    const fy = (lab[0] + 16) / 116, fx = fy + lab[1] / 500, fz = fy - lab[2] / 200;
    const X = 0.95047 * finv(fx), Y = finv(fy), Z = 1.08883 * finv(fz);
    return [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
  }
  function labToRgb(lab) { const l = labToLinRaw(lab); return [fromLin(l[0]), fromLin(l[1]), fromLin(l[2])]; }
  function inGamut(lab) { const l = labToLinRaw(lab); return l.every((v) => v >= -0.002 && v <= 1.002); }
  const lch = (lab) => { const C = Math.hypot(lab[1], lab[2]); let h = Math.atan2(lab[2], lab[1]) / RAD; if (h < 0) h += 360; return [lab[0], C, h]; };
  const lchToLab = (L, C, h) => [L, C * Math.cos(h * RAD), C * Math.sin(h * RAD)];
  /* LCh -> Lab, reducing chroma until the colour is displayable in sRGB */
  function lchFit(L, C, h) {
    L = Math.max(0, Math.min(100, L));
    let lab = lchToLab(L, C, h);
    if (inGamut(lab)) return lab;
    let lo = 0, hi = C;
    for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (inGamut(lchToLab(L, m, h))) lo = m; else hi = m; }
    return lchToLab(L, lo, h);
  }
  const hex2 = (v) => v.toString(16).padStart(2, '0');
  const rgbToHex = (rgb) => '#' + rgb.map((v) => hex2(Math.max(0, Math.min(255, Math.round(v))))).join('');
  const hexToRgb = (hex) => { let h = String(hex).replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const labToHex = (lab) => rgbToHex(labToRgb(lab));
  const hexToLab = (hex) => rgbToLab(hexToRgb(hex));

  /* CIEDE2000 (Sharma et al. 2005) */
  function dE00(l1, l2) {
    const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
    const Cb7 = Math.pow(Cb, 7), G = 0.5 * (1 - Math.sqrt(Cb7 / (Cb7 + 6103515625)));
    const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
    const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
    const hp = (b, a) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / RAD + 360) % 360);
    const h1p = hp(b1, a1p), h2p = hp(b2, a2p);
    const dLp = L2 - L1, dCp = C2p - C1p;
    let dhp = 0;
    if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);
    const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
    let hbp = h1p + h2p;
    if (C1p * C2p !== 0) { hbp = Math.abs(h1p - h2p) > 180 ? (h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2) : (h1p + h2p) / 2; }
    const T = 1 - 0.17 * Math.cos((hbp - 30) * RAD) + 0.24 * Math.cos(2 * hbp * RAD) + 0.32 * Math.cos((3 * hbp + 6) * RAD) - 0.2 * Math.cos((4 * hbp - 63) * RAD);
    const dTh = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
    const Cbp7 = Math.pow(Cbp, 7), Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 6103515625));
    const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
    const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T, Rt = -Math.sin(2 * dTh * RAD) * Rc;
    const x = dLp / Sl, y = dCp / Sc, z = dHp / Sh;
    return Math.sqrt(x * x + y * y + z * z + Rt * y * z);
  }

  /* HSV hue of an RGB triple */
  function rgbHue(rgb) {
    const [r, g, b] = rgb.map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (d === 0) return 0;
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; return h < 0 ? h + 360 : h;
  }
  function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; let r, g, b;
    if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  /* Painter's RYB wheel (Itten) <-> RGB hue — piecewise mapping */
  const rgbHueToRyb = (h) => (h < 60 ? h * 2 : h < 120 ? 120 + (h - 60) : h < 240 ? 180 + (h - 120) / 2 : h);
  const rybToRgbHue = (h) => (h < 120 ? h / 2 : h < 180 ? 60 + (h - 120) : h < 240 ? 120 + (h - 180) * 2 : h);
  /* Lab hue angle of the artist's (RYB) complement of a colour */
  function complementHue(lab) {
    const [, C, h] = lch(lab);
    const probe = labToRgb(lchFit(60, Math.max(C, 35), h));
    const ryb = rgbHueToRyb(rgbHue(probe));
    const compRgb = hsvToRgb(rybToRgbHue((ryb + 180) % 360), 1, 1);
    return lch(rgbToLab(compRgb))[2];
  }
  const WHEEL = [
    ['red', 'primary'], ['red-orange', 'tertiary'], ['orange', 'secondary'], ['yellow-orange', 'tertiary'],
    ['yellow', 'primary'], ['yellow-green', 'tertiary'], ['green', 'secondary'], ['blue-green', 'tertiary'],
    ['blue', 'primary'], ['blue-violet', 'tertiary'], ['violet', 'secondary'], ['red-violet', 'tertiary']];
  function wheelPosition(lab) {
    const probe = labToRgb(lchFit(60, Math.max(lch(lab)[1], 35), lch(lab)[2]));
    const ryb = rgbHueToRyb(rgbHue(probe));
    const i = Math.round(ryb / 30) % 12;
    return { name: WHEEL[i][0], kind: WHEEL[i][1], ryb };
  }

  /* Mixing estimates (not physical models — honest approximations):
     layer/glaze: weighted geometric mean of linear reflectance (subtractive-like)
     tint: linear blend with white (paper showing through, or white paint) */
  function mixLayer(rgbA, rgbB, w) {
    const out = [0, 1, 2].map((i) => Math.exp(w * Math.log(Math.max(1e-4, toLin(rgbA[i]))) + (1 - w) * Math.log(Math.max(1e-4, toLin(rgbB[i])))));
    return out.map(fromLin);
  }
  function mixWhite(rgb, w) { return [0, 1, 2].map((i) => fromLin(toLin(rgb[i]) * (1 - w) + w)); }

  /* Plain-language colour name from Lab */
  function describe(lab, short) {
    const [L, C, h] = lch(lab);
    if (C < 7) {
      const g = L > 92 ? 'white' : L > 78 ? 'very light grey' : L > 62 ? 'light grey' : L > 45 ? 'mid grey' : L > 28 ? 'dark grey' : 'near-black';
      if (C > 3 && L <= 92 && L > 15) return (Math.cos((h - 60) * RAD) > 0 ? 'warm ' : 'cool ') + g;
      return g;
    }
    let n;
    if (h >= 345 || h < 22) n = L > 58 ? 'pink' : 'crimson';
    else if (h < 48) n = L > 66 ? 'pink' : L < 42 && C < 40 ? 'maroon' : 'red';
    else if (h < 72) n = L < 55 && C < 50 ? 'brown' : L > 75 ? 'peach' : 'orange';
    else if (h < 98) n = L < 60 && C < 45 ? 'ochre' : L > 72 && C < 30 ? 'cream' : 'golden yellow';
    else if (h < 112) n = L < 60 ? 'olive' : 'yellow';
    else if (h < 135) n = L < 60 ? 'olive green' : 'yellow-green';
    else if (h < 175) n = 'green';
    else if (h < 215) n = 'teal';
    else if (h < 265) n = L > 70 ? 'sky blue' : 'cyan-blue';
    else if (h < 300) n = 'blue';
    else if (h < 322) n = 'violet';
    else n = 'magenta';
    if (short) return n;
    const pre = L > 82 ? 'pale ' : L > 68 ? 'light ' : L < 28 ? 'deep ' : L < 42 ? 'dark ' : '';
    const mut = C < 18 ? 'muted ' : '';
    return (pre + mut + n).trim();
  }

  root.LucidaColour = { LIN, toLin, fromLin, linToLab, rgbToLab, labToRgb, labToHex, hexToLab, hexToRgb, rgbToHex,
    lch, lchToLab, lchFit, inGamut, dE00, complementHue, wheelPosition, mixLayer, mixWhite, describe, rgbHue };
})(typeof self !== 'undefined' ? self : this);
