/* Lucida — media profiles and colour libraries.
   Brand swatch values are APPROXIMATE screen renderings of printed swatches; they vary by batch, paper and screen.
   Each set is plain data { id, name, media[], approx, colours:[{code,name,hex}] } so more brands can be added. */
(function (root) {
  'use strict';
  const P5 = (a) => a; // readability helper for pressure arrays

  const MEDIA = {
    'cp-wax': {
      name: 'Coloured pencils · wax', short: 'Wax pencils', family: 'pencil', opaque: false, reserve: true, opacity: 0.74, unit: 'Pressure',
      pressure: P5(['Very light', 'Light', 'Medium', 'Firm', 'Heavy / burnish']),
      strokes: { under: 'Loose, tiny circles with the side of a sharp point', base: 'Small overlapping circles — no visible lines', mid: 'Directional strokes that follow the form', shadow: 'Cross-hatch, then small circles to fill the tooth', refine: 'Tiny circles and a needle-sharp point', texture: 'Short broken strokes to suggest texture', reserve: 'Leave untouched' },
      blend: { early: 'Preserve the paper tooth — do not burnish yet', mid: 'Blend lightly only where edges are soft', late: 'Burnish with a white or colourless blender; solvent is optional' },
      highlight: 'Leave the paper bare. For fine highlights, indent them first with an embossing stylus so colour skips over them.',
      tips: ['Wax can “bloom” into a haze — a light spray of fixative clears it.', 'Keep 6–8 layers as a practical maximum before the tooth fills.'],
      sets: ['generic-pencil-48', 'prismacolor-premier', 'generic-pencil-24', 'custom'],
    },
    'cp-oil': {
      name: 'Coloured pencils · oil', short: 'Oil pencils', family: 'pencil', opaque: false, reserve: true, opacity: 0.66, unit: 'Pressure',
      pressure: P5(['Very light', 'Light', 'Medium', 'Firm', 'Heavy']),
      strokes: { under: 'Light, even circles', base: 'Small overlapping circles', mid: 'Directional strokes following the form', shadow: 'Layered cross-hatching', refine: 'Fine point details', texture: 'Short broken strokes', reserve: 'Leave untouched' },
      blend: { early: 'Keep the tooth open — light layers only', mid: 'Blend lightly where transitions are soft', late: 'Blend with a colourless blender pencil or a little odourless mineral spirits' },
      highlight: 'Leave the paper bare; oil pencils are hard to lift, so plan highlights before you start.',
      tips: ['Oil pencils take more layers than wax before saturating — build slowly.'],
      sets: ['polychromos', 'generic-pencil-48', 'generic-pencil-24', 'custom'],
    },
    'cp-water': {
      name: 'Watercolour pencils', short: 'Watercolour pencils', family: 'pencil', opaque: false, reserve: true, opacity: 0.6, unit: 'Pressure',
      pressure: P5(['Very light', 'Light', 'Medium', 'Firm', 'Heavy']),
      strokes: { under: 'Light, even shading — then activate with a damp brush', base: 'Even shading, then a damp brush to dissolve', mid: 'Directional strokes; activate with a barely damp brush', shadow: 'Dense shading; activate and let dry fully', refine: 'Dry pencil on top for crisp detail', texture: 'Dry, broken strokes — do not activate', reserve: 'Leave untouched' },
      blend: { early: 'Activate with water for a smooth wash; let dry', mid: 'Wet for soft transitions, dry for crisp edges', late: 'Keep final details dry for texture' },
      highlight: 'Leave the paper bare; a clean damp brush can lift small highlights.',
      tips: ['Let each activated layer dry completely before the next.'],
      sets: ['generic-pencil-48', 'generic-pencil-24', 'custom'],
    },
    'watercolour': {
      name: 'Watercolour paint', short: 'Watercolour', family: 'paint', opaque: false, reserve: true, opacity: 0.5, unit: 'Dilution', tintWord: 'diluted with water',
      pressure: P5(['Very pale wash', 'Pale wash', 'Medium wash', 'Strong glaze', 'Concentrated paint']),
      strokes: { under: 'Flat, pale glaze (wet-on-dry)', base: 'Graded wash', mid: 'Wet-in-wet for soft transitions; wet-on-dry for edges', shadow: 'Glazes — let each layer dry', refine: 'Small brush, dry-brush details', texture: 'Dry-brush to keep texture', reserve: 'Masking fluid or leave dry' },
      blend: { early: 'Let dry completely', mid: 'Soften edges with a clean damp brush', late: 'Keep final darks crisp — do not overwork' },
      highlight: 'Reserve the white paper — apply masking fluid first or paint carefully around these areas.',
      tips: ['Watercolour dries lighter; push values slightly darker than you think.'],
      sets: ['paint-basic', 'custom'],
    },
    'gouache': {
      name: 'Gouache', short: 'Gouache', family: 'paint', opaque: true, reserve: false, opacity: 0.92, unit: 'Consistency', tintWord: 'with white',
      pressure: P5(['Thin, translucent wash', 'Thin layer', 'Creamy', 'Opaque', 'Thick & opaque']),
      strokes: { under: 'Thin, loose block-in', base: 'Flat opaque shapes', mid: 'Blend edges while wet', shadow: 'Flat opaque darks', refine: 'Small brush, crisp details', texture: 'Dry-brush scumble', reserve: '—' },
      blend: { early: 'Keep thin so later layers don’t lift it', mid: 'Blend wet edges quickly; re-wet carefully', late: 'Crisp final accents' },
      highlight: 'Paint highlights last with white tinted toward the local colour.',
      tips: ['Gouache dries darker (lights) or lighter (darks) — test mixes on scrap.'],
      sets: ['paint-basic', 'custom'],
    },
    'acrylic': {
      name: 'Acrylic', short: 'Acrylic', family: 'paint', opaque: true, reserve: false, opacity: 0.88, unit: 'Consistency', tintWord: 'with white',
      pressure: P5(['Thin glaze', 'Thin layer', 'Medium body', 'Opaque', 'Heavy body']),
      strokes: { under: 'Thin, diluted underpainting', base: 'Block in flat shapes', mid: 'Blend wet-into-wet or glaze', shadow: 'Opaque darks or layered glazes', refine: 'Small brush details and glazes', texture: 'Dry-brush / scumble', reserve: '—' },
      blend: { early: 'Let dry — acrylic is permanent once dry', mid: 'Blend quickly; use retarder for longer blends', late: 'Unify with thin glazes (glaze medium)' },
      highlight: 'Paint highlights last with titanium white mixed with a touch of the local colour.',
      tips: ['Acrylic darkens slightly as it dries.'],
      sets: ['paint-basic', 'custom'],
    },
    'oil': {
      name: 'Oil paint', short: 'Oil', family: 'paint', opaque: true, reserve: false, opacity: 0.85, unit: 'Consistency', tintWord: 'with white',
      pressure: P5(['Thin, lean wash', 'Thin layer', 'Medium body', 'Opaque', 'Impasto']),
      strokes: { under: 'Thin, lean underpainting (paint + solvent)', base: 'Block in shapes', mid: 'Blend into wet paint', shadow: 'Thin, transparent darks', refine: 'Small brush details, glazes', texture: 'Broken colour, scumbling', reserve: '—' },
      blend: { early: 'Lean layers — follow “fat over lean”', mid: 'Blend wet-into-wet with a soft brush', late: 'Glaze with medium once the layer is touch-dry' },
      highlight: 'Highlights go last and thickest (fat over lean) — white with a touch of local colour.',
      tips: ['Keep shadows thin and transparent, lights thicker and opaque.'],
      sets: ['paint-basic', 'custom'],
    },
    'pastel': {
      name: 'Soft pastel', short: 'Pastel', family: 'pastel', opaque: true, reserve: false, opacity: 0.8, unit: 'Pressure',
      pressure: P5(['Feather-light', 'Light', 'Medium', 'Firm', 'Heavy']),
      strokes: { under: 'Side of the stick, very light; can be washed with water/alcohol', base: 'Side of the stick, broad strokes', mid: 'Layer lightly; blend with finger or stump', shadow: 'Light layers of dark colours — don’t fill the tooth', refine: 'Edge of the stick or pastel pencil', texture: 'Broken strokes over the paper grain', reserve: '—' },
      blend: { early: 'Fix lightly with workable fixative', mid: 'Blend with a finger, stump or soft brush', late: 'Leave the final lights unblended and unfixed' },
      highlight: 'Apply the lightest pastels last with a light touch — don’t blend them.',
      tips: ['Work generally dark to light; too much pressure early fills the tooth.'],
      sets: ['generic-pencil-48', 'generic-pencil-24', 'custom'],
    },
    'marker': {
      name: 'Alcohol markers', short: 'Markers', family: 'pencil', opaque: false, reserve: true, opacity: 0.62, unit: 'Passes',
      pressure: P5(['One quick pass', 'One pass', 'Two passes', 'Three passes', 'Four+ passes']),
      strokes: { under: 'Light circular motion with the lightest marker', base: 'Even circles, keep the area wet', mid: 'Flicking strokes from dark into light', shadow: 'Layer while wet; flick into midtones', refine: 'Fine nib / coloured pencil on top', texture: 'Stipple or quick flicks', reserve: 'Leave untouched' },
      blend: { early: 'Keep edges wet to avoid streaks', mid: 'Blend light over dark while wet', late: 'Colourless blender to soften; white gel pen for sparkles' },
      highlight: 'Leave the paper white; add tiny sparkles with a white gel pen at the end.',
      tips: ['Markers can’t be lightened — always go light to dark.'],
      sets: ['generic-pencil-48', 'generic-pencil-24', 'custom'],
    },
    'graphite': {
      name: 'Graphite (tone only)', short: 'Graphite', family: 'mono', opaque: false, reserve: true, opacity: 0.8, unit: 'Pressure',
      pressure: P5(['Very light', 'Light', 'Medium', 'Firm', 'Heavy']),
      strokes: { under: 'Light contour lines only', base: 'Even, light shading', mid: 'Strokes following the form', shadow: 'Layered cross-hatching', refine: 'Sharp point details; kneaded eraser for lifts', texture: 'Short broken strokes', reserve: 'Leave untouched' },
      blend: { early: 'Don’t smudge yet', mid: 'Blend with a stump where transitions are soft', late: 'Lift highlights with a kneaded eraser' },
      highlight: 'Keep the paper clean; lift small highlights with a kneaded eraser at the end.',
      tips: ['Build darks with softer grades, not more pressure, to avoid shine.'],
      sets: ['graphite'],
    },
  };

  const S = (list) => list.map(([code, name, hex]) => ({ code, name, hex }));
  const SETS = {
    'generic-pencil-24': { name: 'Generic 24 colours', approx: false, colours: S([
      ['W', 'White', '#f7f5ef'], ['CR', 'Cream', '#f3e3b5'], ['LY', 'Lemon yellow', '#f2e33a'], ['Y', 'Yellow', '#f6c519'], ['O', 'Orange', '#ef7f1a'],
      ['V', 'Vermilion', '#e2452b'], ['R', 'Red', '#c9232f'], ['CM', 'Crimson', '#9e1b3a'], ['PK', 'Pink', '#ef8fb0'], ['MG', 'Magenta', '#c2337f'],
      ['VI', 'Violet', '#6a3d8f'], ['UB', 'Ultramarine', '#2e3d9c'], ['B', 'Blue', '#2a6fc1'], ['SB', 'Sky blue', '#7fbbe5'], ['T', 'Turquoise', '#1f9fa8'],
      ['DG', 'Dark green', '#1f5a3a'], ['G', 'Green', '#2f9a48'], ['YG', 'Yellow green', '#9cc63b'], ['OL', 'Olive', '#6f7430'], ['YO', 'Yellow ochre', '#c99a3c'],
      ['BS', 'Burnt sienna', '#a04f2b'], ['BR', 'Brown', '#6b4428'], ['GR', 'Grey', '#8c8a86'], ['BK', 'Black', '#252525']]) },
    'generic-pencil-48': { name: 'Generic 48 colours', approx: false, colours: S([
      ['W', 'White', '#f7f5ef'], ['IV', 'Ivory', '#f4ecd2'], ['CR', 'Cream', '#f3e3b5'], ['LY', 'Lemon yellow', '#f2e33a'], ['Y', 'Yellow', '#f6c519'],
      ['GY', 'Golden yellow', '#f2a71b'], ['LO', 'Light orange', '#f6a05a'], ['O', 'Orange', '#ef7f1a'], ['PE', 'Peach', '#f6c3a4'], ['SA', 'Salmon', '#ee8f78'],
      ['V', 'Vermilion', '#e2452b'], ['SC', 'Scarlet', '#d8302b'], ['R', 'Red', '#c9232f'], ['CM', 'Crimson', '#9e1b3a'], ['WR', 'Wine red', '#6e1f2f'],
      ['LP', 'Light pink', '#f6c6d3'], ['PK', 'Pink', '#ef8fb0'], ['RO', 'Rose', '#d9567f'], ['MG', 'Magenta', '#c2337f'], ['RV', 'Red violet', '#8f2f6a'],
      ['LV', 'Lavender', '#b7a3d6'], ['VI', 'Violet', '#6a3d8f'], ['DV', 'Dark violet', '#3e2457'], ['UB', 'Ultramarine', '#2e3d9c'], ['IN', 'Indigo', '#243050'],
      ['B', 'Blue', '#2a6fc1'], ['SB', 'Sky blue', '#7fbbe5'], ['LB', 'Light blue', '#b9dbf0'], ['T', 'Turquoise', '#1f9fa8'], ['TL', 'Teal', '#1b6b6a'],
      ['MN', 'Mint', '#a6dcc0'], ['LG', 'Light green', '#8fd18a'], ['G', 'Green', '#2f9a48'], ['EG', 'Emerald', '#13805a'], ['DG', 'Dark green', '#1f5a3a'],
      ['YG', 'Yellow green', '#9cc63b'], ['OL', 'Olive', '#6f7430'], ['MO', 'Moss', '#4c5a2c'], ['YO', 'Yellow ochre', '#c99a3c'], ['RS', 'Raw sienna', '#b5793a'],
      ['BS', 'Burnt sienna', '#a04f2b'], ['TC', 'Terracotta', '#b5583c'], ['BR', 'Brown', '#6b4428'], ['DB', 'Dark brown', '#3f2a1e'], ['WG', 'Warm grey', '#a39a8e'],
      ['CG', 'Cool grey', '#9aa0a6'], ['DGR', 'Dark grey', '#57585a'], ['BK', 'Black', '#252525']]) },
    'prismacolor-premier': { name: 'Prismacolor Premier (selection)', approx: true, colours: S([
      ['PC938', 'White', '#f6f4ee'], ['PC914', 'Cream', '#f4e4b6'], ['PC927', 'Light Peach', '#f8cfb4'], ['PC939', 'Peach', '#f6b18f'], ['PC928', 'Blush Pink', '#f4c2c6'],
      ['PC929', 'Pink', '#ee86a6'], ['PC993', 'Hot Pink', '#e8578e'], ['PC930', 'Magenta', '#b52f73'], ['PC995', 'Mulberry', '#9a2f6c'], ['PC926', 'Carmine Red', '#c62b3f'],
      ['PC924', 'Crimson Red', '#b8203a'], ['PC925', 'Crimson Lake', '#8f1f37'], ['PC937', 'Tuscan Red', '#6b2a2c'], ['PC923', 'Scarlet Lake', '#d3302f'], ['PC922', 'Poppy Red', '#de3b2e'],
      ['PC921', 'Pale Vermilion', '#e85a34'], ['PC918', 'Orange', '#f07d1e'], ['PC917', 'Sunburst Yellow', '#f8bb16'], ['PC916', 'Canary Yellow', '#f8d41a'], ['PC915', 'Lemon Yellow', '#f2e536'],
      ['PC989', 'Chartreuse', '#cfe03c'], ['PC912', 'Apple Green', '#6cbf4a'], ['PC913', 'Spring Green', '#6ccd8a'], ['PC910', 'True Green', '#219a52'], ['PC909', 'Grass Green', '#2c8a3f'],
      ['PC911', 'Olive Green', '#6c7538'], ['PC1005', 'Limepeel', '#a2a347'], ['PC908', 'Dark Green', '#1d4d36'], ['PC907', 'Peacock Green', '#00837c'], ['PC905', 'Aquamarine', '#29a7a0'],
      ['PC904', 'Light Cerulean Blue', '#4fb3df'], ['PC903', 'True Blue', '#1f78bf'], ['PC906', 'Copenhagen Blue', '#2e5e9f'], ['PC902', 'Ultramarine', '#2c3e95'], ['PC901', 'Indigo Blue', '#243458'],
      ['PC933', 'Violet Blue', '#4b4596'], ['PC932', 'Violet', '#5f3b8e'], ['PC931', 'Dark Purple', '#4a2a5c'], ['PC956', 'Lilac', '#c49bd0'], ['PC996', 'Black Grape', '#3e2c45'],
      ['PC940', 'Sand', '#e3cb99'], ['PC942', 'Yellow Ochre', '#c89a46'], ['PC941', 'Light Umber', '#9a7651'], ['PC943', 'Burnt Ochre', '#b1592f'], ['PC944', 'Terra Cotta', '#b3573f'],
      ['PC945', 'Sienna Brown', '#8f4a2f'], ['PC946', 'Dark Brown', '#5a3b2a'], ['PC947', 'Dark Umber', '#45322a'], ['PC948', 'Sepia', '#4e3a2e'], ['PC936', 'Slate Grey', '#6e7378'],
      ['PC1054', 'Warm Grey 10%', '#e4ded4'], ['PC1059', 'Cool Grey 10%', '#dfe2e3'], ['PC935', 'Black', '#232323']]) },
    'polychromos': { name: 'Faber-Castell Polychromos (selection)', approx: true, colours: S([
      ['101', 'White', '#f7f6f1'], ['102', 'Cream', '#f3e7c3'], ['103', 'Ivory', '#f2e2ad'], ['104', 'Light yellow glaze', '#f6ea7a'], ['105', 'Light cadmium yellow', '#f8e04a'],
      ['107', 'Cadmium yellow', '#f8c81f'], ['109', 'Dark chrome yellow', '#f4a51b'], ['111', 'Cadmium orange', '#ef7f22'], ['115', 'Dark cadmium orange', '#e9632a'], ['117', 'Light cadmium red', '#e4402f'],
      ['118', 'Scarlet red', '#d9342f'], ['121', 'Pale geranium lake', '#d63848'], ['126', 'Permanent carmine', '#b41f3e'], ['225', 'Dark red', '#8e1f30'], ['129', 'Pink madder lake', '#ec8fac'],
      ['128', 'Light purple pink', '#f2b5cb'], ['124', 'Rose carmine', '#d24a7c'], ['133', 'Magenta', '#b5317a'], ['194', 'Red-violet', '#8c2e6b'], ['249', 'Mauve', '#7d4f93'],
      ['138', 'Violet', '#5a3e8c'], ['137', 'Blue violet', '#4a4a9c'], ['120', 'Ultramarine', '#2d3e98'], ['143', 'Cobalt blue', '#2f5ea8'], ['110', 'Phthalo blue', '#1f63ad'],
      ['146', 'Smalt blue', '#5c9bd0'], ['147', 'Light blue', '#9ecbe8'], ['246', 'Prussian blue', '#1f3c5a'], ['157', 'Dark indigo', '#253046'], ['153', 'Cobalt turquoise', '#1aa0b0'],
      ['156', 'Cobalt green', '#4aa596'], ['161', 'Phthalo green', '#0e7f5f'], ['163', 'Emerald green', '#14915d'], ['166', 'Grass green', '#3c9a3e'], ['171', 'Light green', '#86c86a'],
      ['170', 'May green', '#a6c94a'], ['168', 'Earth green yellowish', '#8f8c3d'], ['167', 'Permanent green olive', '#5f7a32'], ['165', 'Juniper green', '#2f5a45'], ['278', 'Chrome oxide green', '#4d7448'],
      ['183', 'Light yellow ochre', '#d9ad55'], ['184', 'Dark Naples ochre', '#c99752'], ['182', 'Brown ochre', '#a8743a'], ['187', 'Burnt ochre', '#a95a33'], ['186', 'Terracotta', '#b3604a'],
      ['283', 'Burnt siena', '#8a4630'], ['176', 'Van Dyck brown', '#4b3426'], ['175', 'Dark sepia', '#3e3029'], ['132', 'Light flesh', '#f5cdb3'], ['131', 'Medium flesh', '#eeae8f'],
      ['270', 'Warm grey I', '#e3ded3'], ['272', 'Warm grey III', '#b6ada0'], ['274', 'Warm grey V', '#7f776d'], ['230', 'Cold grey I', '#dfe2e2'], ['232', 'Cold grey III', '#a9aeb1'],
      ['234', 'Cold grey V', '#6d7378'], ['181', "Payne's grey", '#3c4550'], ['199', 'Black', '#232323']]) },
    'paint-basic': { name: 'Core paint palette (generic pigments)', approx: true, colours: S([
      ['PW6', 'Titanium white', '#f7f7f3'], ['PY3', 'Lemon yellow', '#f4e231'], ['PY35', 'Cadmium yellow', '#f7c21c'], ['PY42', 'Yellow ochre', '#c8923a'], ['PO20', 'Cadmium orange', '#eb7523'],
      ['PR108', 'Cadmium red', '#d3322c'], ['PR83', 'Alizarin crimson', '#8f1d33'], ['PV19', 'Quinacridone rose', '#c4336b'], ['PV23', 'Dioxazine violet', '#45286b'], ['PB29', 'Ultramarine blue', '#2b3a96'],
      ['PB15', 'Phthalo blue', '#1a4f97'], ['PB35', 'Cerulean blue', '#3b8fc6'], ['PG7', 'Phthalo green', '#0f6b56'], ['PG17', 'Chromium oxide green', '#5b7a46'], ['PBr7s', 'Raw sienna', '#b47a38'],
      ['PBr7', 'Burnt sienna', '#8e4428'], ['PBr7u', 'Burnt umber', '#4e3526'], ['PBk6', "Payne's grey", '#39424d'], ['PBk11', 'Mars black', '#232323']]) },
    'graphite': { name: 'Graphite grades', approx: true, mono: true, colours: S([
      ['4H', '4H', '#bdbdbd'], ['2H', '2H', '#a9a9a9'], ['HB', 'HB', '#8e8e8e'], ['2B', '2B', '#717171'], ['4B', '4B', '#595959'], ['6B', '6B', '#474747'], ['8B', '8B', '#3a3a3a']]) },
    custom: { name: 'My custom set', approx: false, colours: [] },
  };
  root.LucidaLibrary = { MEDIA, SETS };
})(typeof self !== 'undefined' ? self : this);
