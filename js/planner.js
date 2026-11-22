/* Lucida — painting planner.
   Turns the image analysis into a medium-specific, layer-by-layer plan.
   All colour recommendations are ESTIMATES from photo pixels; real results depend on paper, pressure and pigment. */
(function (root) {
  'use strict';
  const CL = root.LucidaColour, LIB = root.LucidaLibrary;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function prepColours(list) { return list.map((c) => ({ ...c, rgb: CL.hexToRgb(c.hex), lab: CL.hexToLab(c.hex) })); }
  const label = (c) => (c.code && c.code !== c.name ? `${c.name} (${c.code})` : c.name);
  const quality = (d) => (d < 3 ? 'very close' : d < 6 ? 'close' : d < 10 ? 'approximate' : 'loose');

  /* ---------- nearest available colour (single, layered pair, mix, or tint) ---------- */
  function makeMatcher(colours, med) {
    const cache = new Map();
    const white = colours.find((c) => /white/i.test(c.name) && c.lab[0] > 93);
    const paint = med.family === 'paint';
    const canTint = !med.opaque || !!white;
    const mono = med.family === 'mono';
    return function match(lab) {
      const key = lab.map((v) => Math.round(v * 2)).join(',');
      if (cache.has(key)) return cache.get(key);
      let best;
      if (!colours.length) best = { type: 'none', items: [], dE: 99, rgb: CL.labToRgb(lab) };
      else if (mono) {
        const sorted = colours.slice().sort((a, b) => b.lab[0] - a.lab[0]);
        const g = sorted.find((c) => c.lab[0] <= lab[0] + 4) || sorted[sorted.length - 1];
        best = { type: 'grade', items: [g], dE: Math.abs(g.lab[0] - lab[0]), rgb: CL.labToRgb([lab[0], 0, 0]) };
      } else {
        const scored = colours.map((c) => ({ c, d: CL.dE00(lab, c.lab) })).sort((a, b) => a.d - b.d);
        best = { type: 'single', items: [scored[0].c], dE: scored[0].d, rgb: scored[0].c.rgb };
        if (best.dE > 3.5) {
          const top = scored.slice(0, 10).map((s) => s.c);
          // prefer the simplest option: one colour, then one colour lightened, then a two-colour layer/mix
          if (canTint) for (const c of top) for (const w of [0.25, 0.5, 0.7]) {
            if (c === white) continue;
            const rgb = CL.mixWhite(c.rgb, w), d = CL.dE00(lab, CL.rgbToLab(rgb));
            if (d < best.dE - 1.5) best = { type: 'tint', items: [c], w, dE: d, rgb };
          }
          if (best.dE > 3.5) for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) for (const w of [0.3, 0.5, 0.7]) {
            const rgb = CL.mixLayer(top[i].rgb, top[j].rgb, w), d = CL.dE00(lab, CL.rgbToLab(rgb));
            if (d < best.dE - 3) best = { type: paint ? 'mix' : 'layer', items: w >= 0.5 ? [top[i], top[j]] : [top[j], top[i]], w: Math.max(w, 1 - w), dE: d, rgb };
          }
        }
      }
      best.hex = CL.rgbToHex(best.rgb);
      best.quality = best.type === 'grade' ? 'tone' : quality(best.dE);
      best.text = matchText(best, med, white);
      best.key = best.text;
      cache.set(key, best);
      return best;
    };
  }
  function matchText(m, med, white) {
    const [a, b] = m.items;
    if (m.type === 'none') return 'No colours selected — enable some in My colours';
    if (m.type === 'single' || m.type === 'grade') return label(a);
    const pa = Math.round(m.w * 10), pb = 10 - pa;
    if (m.type === 'layer') return `${label(a)} layered with ${label(b)} (≈${pa}:${pb})`;
    if (m.type === 'mix') return `Mix ${label(a)} + ${label(b)} (≈${pa}:${pb})`;
    if (m.type === 'tint') {
      const pw = Math.round(m.w * 10);
      if (med.family === 'paint' && med.opaque) return `${label(a)} + ${white ? white.name : 'white'} (≈${10 - pw}:${pw})`;
      if (med.family === 'paint') return `${label(a)}, ${med.tintWord} (paler wash)`;
      if (med.family === 'pastel') return `${label(a)}, softened with a light layer of ${white ? white.name : 'white'}`;
      return `${label(a)} at lighter ${med.unit.toLowerCase()} — let the paper show`;
    }
    return label(a);
  }

  /* ---------- per-region colour-theory decisions (medium independent) ---------- */
  function decide(A) {
    return A.regions.map((r) => {
      const fam = A.families[r.family];
      const L = r.lab[0], C = r.C;
      const reserve = r.tone === 'highlight' && L >= 76 && C < 34;
      let comp = null, rich = false, why = '';
      if (fam && !fam.neutral && r.tone !== 'highlight') {
        const Cl = fam.litC, darkness = 1 - r.t, desat = Cl > 1 ? clamp((Cl - C) / Cl, 0, 1) : 0;
        if (darkness > 0.35 && C >= 6) {
          if (desat < 0.12 && darkness > 0.5 && C > 25) { rich = true; why = 'Shadow keeps nearly full saturation — keep it rich with a deeper analogous colour, no complement.'; }
          else {
            const score = 0.55 * darkness + 0.45 * desat;
            if (score > 0.35) {
              const I = clamp((score - 0.25) / 0.75, 0, 1) * 0.55 + 0.12;
              const hue = CL.complementHue(fam.lit);
              const lab = CL.lchFit(88 - 22 * I, Math.min(38, 12 + 34 * I), hue);
              comp = { I, lab, hex: CL.labToHex(lab), hue, desat, darkness };
              why = `Darker (${Math.round(darkness * 100)}% down the family's value range) and ${Math.round(desat * 100)}% less saturated than the lit ${fam.name} — a pale complement neutralises it optically.`;
            }
          }
        } else if (darkness <= 0.35) why = `Lit side of the ${fam.name} — keep it clean and pure; no complement here.`;
      } else if (fam && fam.neutral) why = 'Neutral (low-chroma) area — no complementary underlayer needed.';
      else if (r.tone === 'highlight') why = 'Highlight — keep as light as possible.';
      return { reserve, comp, rich, why };
    });
  }

  /* ---------- helpers for building layers ---------- */
  const STROKE_KEY = { reserve: 'reserve', under: 'under', base: 'base', light: 'base', mid: 'mid', shadow: 'shadow', reflect: 'refine', highlight: 'refine', refine: 'refine', tone1: 'base', tone2: 'mid', tone3: 'shadow', tone4: 'shadow', lift: 'refine' };
  function group(A, entries, match, opts) {
    const g = new Map();
    for (const e of entries) {
      const r = A.regions[e.id];
      const m = opts.fixed || match(e.lab);
      const k = (opts.name || '') + '|' + m.key;
      let o = g.get(k);
      if (!o) { o = { match: m, regions: [], area: 0, IA: 0, lab: [0, 0, 0] }; g.set(k, o); }
      o.regions.push({ id: e.id, I: clamp(e.I, 0.05, 1) });
      o.area += r.area; o.IA += e.I * r.area; o.lab[0] += e.lab[0] * r.area; o.lab[1] += e.lab[1] * r.area; o.lab[2] += e.lab[2] * r.area;
    }
    return [...g.values()].map((o) => {
      const lab = o.lab.map((v) => v / o.area);
      return { kind: opts.kind || 'colour', name: opts.name || o.match.text, note: opts.note || '', match: o.match, target: CL.labToHex(lab), targetLab: lab,
        regions: o.regions.sort((a, b) => A.regions[b.id].area - A.regions[a.id].area), I: o.IA / o.area, area: o.area };
    }).sort((a, b) => b.area - a.area);
  }
  function decorate(A, layer, med, prevColour) {
    for (const app of layer.apps) {
      const idx = Math.min(4, Math.floor(app.I * 5));
      app.pressure = app.kind === 'reserve' ? 'Leave untouched' : med.pressure[idx];
      app.pressureLevel = idx;
      app.visible = prevColour && app.kind !== 'reserve' ? clamp(Math.round(100 * (1 - app.I * med.opacity)), 5, 95) : null;
      // stroke from dominant surface form
      const forms = {}; let big = null;
      for (const r of app.regions) { const rg = A.regions[r.id]; forms[rg.form] = (forms[rg.form] || 0) + rg.area; if (!big || rg.area > A.regions[big].area) big = r.id; }
      const dom = Object.entries(forms).sort((a, b) => b[1] - a[1])[0];
      let s = med.strokes[STROKE_KEY[layer.key]] || med.strokes.base;
      if (['mid', 'shadow', 'light', 'tone2', 'tone3'].includes(layer.key) && dom) {
        if (dom[0] === 'curved') { s = `${med.strokes.mid} — curve around the form`; const ls = big != null && A.regions[big].lightSide; if (ls) s += `, getting lighter towards ${ls}`; }
        else if (dom[0] === 'textured') s = med.strokes.texture;
      }
      app.stroke = app.kind === 'reserve' ? med.strokes.reserve : s;
      app.blend = app.kind === 'reserve' ? '—' : layer.blend;
    }
  }
  const ids = (list) => list.map((r) => r.id);

  /* ---------- main entry ---------- */
  function build(A, opts) {
    const med = LIB.MEDIA[opts.medium] || LIB.MEDIA['cp'];
    // transparent paint: lighten with water, never white paint
    const colours = prepColours((opts.colours || []).filter((c) => !(med.family === 'paint' && !med.opaque && /white/i.test(c.name))));
    const match = makeMatcher(colours, med);
    const dec = decide(A);
    const R = A.regions, T = A.tones;
    const isReserve = (r) => med.reserve && dec[r.id].reserve;
    const notHi = R.filter((r) => !isReserve(r));
    const layers = [];
    const L = (key, title, purpose, apps, extra) => { const l = { key, title, purpose, apps: apps.filter((a) => a.regions.length), avoid: [], tips: [], blend: '', ...(extra || {}) }; if (l.apps.length) layers.push(l); return l; };
    const hiRegions = R.filter((r) => dec[r.id].reserve || r.tone === 'highlight');
    const famName = (ids) => [...new Set(ids.map((i) => A.families[R[i].family] && A.families[R[i].family].name))].filter(Boolean).slice(0, 3).join(', ');
    const darkLab = (r) => r.lab;

    /* reusable layer contents */
    const compRegions = R.filter((r) => dec[r.id].comp && !isReserve(r));
    const compFams = new Set(compRegions.map((r) => r.family));
    const underApps = () => group(A, compRegions.map((r) => ({ id: r.id, lab: dec[r.id].comp.lab, I: dec[r.id].comp.I })), match, { kind: 'complement' });
    const baseApps = () => {
      const e = [];
      for (const r of notHi) {
        const f = A.families[r.family]; if (!f) continue;
        const lab = [Math.min(f.lit[0] + 6, 93), f.lit[1] * 0.85, f.lit[2] * 0.85];
        e.push({ id: r.id, lab, I: r.tone === 'highlight' ? 0.15 : clamp(0.22 + 0.25 * (1 - r.t), 0.18, 0.5) });
      }
      return group(A, e, match, {});
    };
    const midSel = R.filter((r) => !isReserve(r) && r.tone !== 'highlight' && r.tone !== 'deep shadow' && r.t < 0.88);
    const midApps = (opaque) => group(A, (opaque ? R.filter((r) => r.tone === 'midtone' || (r.tone === 'light' && r.t < 0.7)) : midSel).map((r) => ({ id: r.id, lab: r.lab, I: clamp(0.3 + 0.4 * (1 - r.t), 0.3, 0.7) })), match, {});
    const shadowSel = R.filter((r) => !isReserve(r) && (r.tone === 'shadow' || r.tone === 'deep shadow' || (r.t < 0.3 && r.tone !== 'highlight' && r.tone !== 'light')));
    const shadowApps = () => {
      const local = group(A, shadowSel.map((r) => ({ id: r.id, lab: darkLab(r), I: 0.55 + 0.4 * clamp((0.38 - r.v) / 0.38, 0, 1) })), match, {});
      const glaze = group(A, shadowSel.filter((r) => dec[r.id].comp && dec[r.id].comp.darkness > 0.6 && dec[r.id].comp.desat > 0.25).map((r) => ({ id: r.id, lab: CL.lchFit(r.lab[0] + 6, 20, dec[r.id].comp.hue), I: 0.35 })), match, { kind: 'complement', note: 'Complementary glaze — deepens and neutralises without black' });
      const rich = group(A, shadowSel.filter((r) => dec[r.id].rich).map((r) => { const w = r.temp === 'warm'; return { id: r.id, lab: CL.lchFit(r.lab[0] - 8, r.C + 6, (r.h + (w ? -12 : 12) + 360) % 360), I: 0.5 }; }), match, { kind: 'analogous', note: 'Rich analogous shadow — keeps saturation in glowing darks' });
      glaze.forEach((g) => { g.name = g.match.text; }); rich.forEach((g) => { g.name = g.match.text; });
      return local.concat(glaze, rich);
    };
    const reflSel = R.filter((r) => r.reflected);
    const reflApps = () => group(A, reflSel.map((r) => { const s = R[r.reflected.from]; const lab = [r.lab[0] + 6, (r.lab[1] + s.lab[1]) / 2, (r.lab[2] + s.lab[2]) / 2]; return { id: r.id, lab, I: 0.28 }; }), match, { kind: 'reflected', note: 'Bounce light picked up from the neighbouring surface' });
    const lightSel = R.filter((r) => !isReserve(r) && (r.tone === 'light' || (r.tone === 'highlight' && !dec[r.id].reserve)));
    const whiteLab = [97, 0, 2];

    if (med.family === 'mono') {
      const g = (sel, I, name) => group(A, sel.map((r) => ({ id: r.id, lab: [r.lab[0], 0, 0], I: typeof I === 'function' ? I(r) : I })), match, name ? { name } : {});
      const hi = R.filter((r) => dec[r.id].reserve || r.tone === 'highlight');
      L('reserve', 'Map the values & protect highlights', `Lightly outline the region boundaries shown. Keep the ${hi.length} highlight area${hi.length === 1 ? '' : 's'} completely clean.`,
        [{ kind: 'reserve', name: 'Leave paper white', match: { text: 'Paper', hex: '#ffffff' }, target: '#ffffff', regions: hi.map((r) => ({ id: r.id, I: 1 })), I: 1, area: 1 }]);
      L('tone1', 'Light tone over everything else', 'An even, pale base tone across every non-highlight area.', g(R.filter((r) => r.tone !== 'highlight'), 0.25));
      L('tone2', 'Midtones', 'Build the midtones and shape the forms.', g(R.filter((r) => r.v < 0.66 && r.tone !== 'highlight'), (r) => 0.35 + 0.3 * (1 - r.t)));
      L('tone3', 'Shadows', 'Darken shadow shapes with softer grades.', g(R.filter((r) => r.v < 0.38), 0.65));
      L('tone4', 'Deepest darks', 'Only the darkest accents — this sets the full value range.', g(R.filter((r) => r.v < 0.15 || r.lab[0] < 20), 0.9));
      L('lift', 'Lift & refine highlights', 'Lift back light areas with a kneaded eraser and refine edges.', g(R.filter((r) => r.tone === 'light' || r.tone === 'highlight'), 0.3, 'Kneaded eraser / clean paper'));
    } else if (!med.opaque) {
      /* transparent media: light to dark */
      const hi = R.filter((r) => dec[r.id].reserve);
      if (hi.length) L('reserve', 'Protect the highlights', `${med.highlight} These ${hi.length} area${hi.length === 1 ? ' stays' : 's stay'} untouched until the end.`,
        [{ kind: 'reserve', name: 'Leave paper white', match: { text: 'Paper white', hex: '#ffffff', items: [] }, target: '#ffffff', regions: hi.map((r) => ({ id: r.id, I: 1 })), I: 1, area: 1 }]);
      const ua = underApps();
      const richN = R.filter((r) => dec[r.id].rich).length;
      if (ua.length) L('under', 'Complementary underpainting', `In the ${famName(compRegions.map((r) => r.id))} areas, ${compRegions.length} shadow/midtone region${compRegions.length === 1 ? ' is' : 's are'} darker and greyer than the lit colour. A pale complementary layer there will neutralise and deepen them through the later colour.${richN ? ` ${richN} deep area${richN === 1 ? ' keeps' : 's keep'} full saturation and get no complement.` : ''} Lit areas stay pure.`, ua,
        { avoid: R.filter((r) => !dec[r.id].comp && compFams.has(r.family) && r.t > 0.6).map((r) => r.id) });
      L('base', 'Base local colours', 'Lay in the overall local colour of each colour family, lightly and evenly, over the underpainting.', baseApps());
      L('mid', 'Midtones, warm & cool variations', 'Introduce the actual colour of each region — this is where the warm/cool shifts measured in the photo come in. Notes per colour show which areas read warmer or cooler.', midApps(false));
      L('shadow', 'Shadows & depth', 'Deepen shadow and overlap areas with their local shadow colour; complementary glazes darken without dulling to black.', shadowApps());
      if (reflSel.length) L('reflect', 'Reflected light', `${reflSel.length} shadow area${reflSel.length === 1 ? '' : 's'} pick${reflSel.length === 1 ? 's' : ''} up bounced light from a neighbouring surface — lift them slightly with that surface's colour.`, reflApps());
      const hiApps = group(A, lightSel.map((r) => ({ id: r.id, lab: [Math.min(97, r.lab[0] + 3), r.lab[1] * 0.7, r.lab[2] * 0.7], I: 0.22 })), match, {});
      if (med.family === 'pencil' && med !== LIB.MEDIA['cp-water'] && med !== LIB.MEDIA.marker) hiApps.push(...group(A, lightSel.filter((r) => r.tone === 'light').map((r) => ({ id: r.id, lab: whiteLab, I: 0.55 })), match, { name: 'Burnish lit areas', note: 'Burnish to smooth the grain and brighten' }));
      L('highlight', 'Highlights & luminosity', `Recover luminosity in the lightest areas. ${med.highlight}`, hiApps);
    } else {
      /* opaque media: underpainting, darks first, then lights */
      const ua = underApps();
      if (ua.length) L('under', 'Complementary underpainting', `Thinly block in a complementary tone under the ${famName(compRegions.map((r) => r.id))} shadows (${compRegions.length} regions). Glimpses of it between later strokes give shadows depth; lit areas get none.`, ua,
        { avoid: R.filter((r) => !dec[r.id].comp && compFams.has(r.family) && r.t > 0.6).map((r) => r.id) });
      L('shadow', 'Block in the darks', 'Establish shadow and overlap shapes first, thinly.', shadowApps());
      L('mid', 'Midtones & local colour', 'Paint the midtones with the actual colour of each region, blending into the darks.', midApps(true));
      L('light', 'Light areas', 'Paint the light planes facing the light.', group(A, R.filter((r) => r.tone === 'light' || (r.tone === 'highlight' && !dec[r.id].reserve)).map((r) => ({ id: r.id, lab: r.lab, I: 0.7 })), match, {}));
      if (reflSel.length) L('reflect', 'Reflected light', `Add bounced light into ${reflSel.length} shadow area${reflSel.length === 1 ? '' : 's'} with the neighbouring colour — keep it darker than the lit side.`, reflApps());
      L('highlight', 'Highlights', med.highlight, group(A, R.filter((r) => r.tone === 'highlight' || dec[r.id].reserve).map((r) => ({ id: r.id, lab: r.lab, I: 0.85 })), match, {}));
    }
    /* refinement — edges and transitions (all media) */
    const hardRegs = R.filter((r) => r.nb.some((n) => !n.soft && n.dE > 18)).sort((a, b) => b.nb.reduce((s, n) => s + (!n.soft ? n.dE * n.len : 0), 0) - a.nb.reduce((s, n) => s + (!n.soft ? n.dE * n.len : 0), 0)).slice(0, 14);
    const softRegs = R.filter((r) => r.nb.some((n) => n.soft) && !hardRegs.includes(r)).slice(0, 18);
    const lab = (r) => (med.family === 'mono' ? [r.lab[0], 0, 0] : r.lab);
    L('refine', 'Refinement & edges', `Sharpen the ${hardRegs.length} strongest edges (overlaps and object boundaries) and soften the gradual transitions. ${med.blend.late}.`,
      group(A, hardRegs.map((r) => ({ id: r.id, lab: lab(r), I: 0.7 })), match, { note: 'Sharpen the edge against its neighbour' })
        .concat(group(A, softRegs.map((r) => ({ id: r.id, lab: lab(r), I: 0.3 })), match, { note: 'Blend into the neighbouring region' })));

    /* blend guidance, avoid lists, visibility */
    let colourSeen = false;
    layers.forEach((l, i) => {
      l.index = i;
      l.blend = ['reserve', 'under', 'base', 'tone1'].includes(l.key) ? med.blend.early : ['refine', 'highlight', 'lift'].includes(l.key) ? med.blend.late : med.blend.mid;
      if (!l.avoid.length) l.avoid = ids(hiRegions).filter((id) => !l.apps.some((a) => a.regions.some((r) => r.id === id)));
      decorate(A, l, med, colourSeen);
      if (l.key !== 'reserve') colourSeen = true;
      if (i === 0 && med.tips) l.tips = med.tips.slice();
      l.apps.forEach((a) => {
        if (l.key === 'mid' && !a.note) {
          const warm = a.regions.filter((r) => R[r.id].relTemp === 'warmer').length, cool = a.regions.filter((r) => R[r.id].relTemp === 'cooler').length;
          if (warm || cool) a.note = `${warm ? warm + ' area' + (warm > 1 ? 's' : '') + ' read warmer' : ''}${warm && cool ? ', ' : ''}${cool ? cool + ' cooler' : ''} than their colour family`;
        }
        if (a.match && a.match.quality === 'loose') a.note = (a.note ? a.note + '. ' : '') + 'No close match in your set — test on scrap paper';
      });
    });

    /* per-region index into the plan (for the colour-map inspector) */
    const regionInfo = R.map((r) => ({ layers: [], match: match(med.family === 'mono' ? [r.lab[0], 0, 0] : r.lab), dec: dec[r.id] }));
    layers.forEach((l, li) => l.apps.forEach((a, ai) => a.regions.forEach((rr) => regionInfo[rr.id].layers.push({ li, ai, I: rr.I, pressure: a.pressure }))));
    regionInfo.forEach((ri, id) => {
      const r = R[id], f = A.families[r.family];
      const h = f && !f.neutral ? CL.complementHue(f.lit) : (r.C > 4 ? CL.complementHue(r.lab) : null);
      ri.complement = h == null ? null : { hex: CL.labToHex(CL.lchFit(72, 32, h)), lab: CL.lchFit(72, 32, h) };
      if (ri.complement) ri.complement.match = match(ri.complement.lab);
      const maxI = ri.layers.reduce((m, x) => Math.max(m, x.I), 0);
      ri.maxI = maxI;
    });
    return { medium: opts.medium, med, setId: opts.setId, layers, regionInfo, insights: insights(A, dec), colourCount: colours.length };
  }

  function insights(A, dec) {
    const R = A.regions, out = [];
    const l = A.light;
    out.push(l.reliable ? `Light appears to come from ${l.dir} (consistency ${Math.round(l.confidence * 100)}%). Estimated from shading gradients across ${R.filter((r) => r.form === 'curved').length} smoothly shaded regions.`
      : 'No single strong light direction detected — the lighting looks soft or diffuse, so shading cues are weak.');
    const c = A.stats.contrast;
    out.push(`Tonal range L* ${A.tones.p03.toFixed(0)}–${A.tones.p97.toFixed(0)} — ${c > 70 ? 'high contrast: plan strong darks' : c > 45 ? 'moderate contrast' : 'low contrast: keep values subtle and close'}.`);
    const area = (fn) => R.filter(fn).reduce((s, r) => s + r.frac, 0);
    const warm = area((r) => r.temp === 'warm'), cool = area((r) => r.temp === 'cool');
    out.push(`Temperature: ${Math.round(warm * 100)}% warm, ${Math.round(cool * 100)}% cool, ${Math.round((1 - warm - cool) * 100)}% neutral by area.`);
    // lit vs shadow temperature, compared within each colour family (so a big background can't skew it)
    const wAvg = (rs) => { const a = rs.reduce((s, r) => s + r.area, 0); return a ? rs.reduce((s, r) => s + r.warmth * r.area, 0) / a : null; };
    let dSum = 0, dW = 0;
    for (const f of A.families) {
      if (f.neutral) continue;
      const rs = f.regions.map((i) => R[i]), lw = wAvg(rs.filter((r) => r.t > 0.6)), sw = wAvg(rs.filter((r) => r.t < 0.35));
      if (lw == null || sw == null) continue;
      dSum += (lw - sw) * f.area; dW += f.area;
    }
    if (dW) { const d = dSum / dW; if (Math.abs(d) > 4) out.push(d > 0 ? 'Within each colour, shadows measure cooler than the lit areas — warm light, cool shadows: cool the darks rather than just darkening them.' : 'Within each colour, shadows measure warmer than the lit areas — a cool light source; keep the shadows warm.'); else out.push('Lit and shadow sides of each colour have similar temperature — darken mainly with value and complements.'); }
    const comp = dec.filter((d) => d.comp).length, rich = dec.filter((d) => d.rich).length;
    out.push(comp ? `${comp} region${comp === 1 ? '' : 's'} benefit from complementary underpainting; ${rich} deep area${rich === 1 ? '' : 's'} should stay rich and warm (no complement).` : 'No regions clearly benefit from complementary underpainting (shadows are already neutral or the image is mostly lit).');
    const refl = R.filter((r) => r.reflected).length;
    if (refl) out.push(`${refl} possible reflected-light area${refl === 1 ? '' : 's'} found — lighter patches inside shadows, on the side away from the light.`);
    out.push(`${A.stats.hard} hard edges and ${A.stats.soft} soft transitions between ${A.stats.regions} regions; ${A.stats.overlaps} long boundaries look like overlapping objects.`);
    return out;
  }

  root.LucidaPlanner = { build, prepColours };
})(typeof self !== 'undefined' ? self : this);
