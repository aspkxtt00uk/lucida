# Lucida — AR Trace & Paint

A free web app for iPhone Safari. You see your reference photo over the live camera so you can trace it onto paper. It can also analyse the photo and build a colour-theory painting plan, one layer at a time, for the medium you choose.

There's no backend, no account, no paid APIs and no AI services. Everything runs in your browser.

## What's in the folder

```
index.html            UI and styles
js/app.js             camera, gestures, overlay, library, painting UI
js/engine.js          image engine (runs in a Web Worker): filters + analysis
js/colour.js          colour science: CIELAB, CIEDE2000, artist (RYB) complements
js/planner.js         turns the analysis into a medium-specific layer plan
js/library.js         media profiles + colour sets (add brands here)
sw.js, manifest.webmanifest, icons/   offline support + "Add to Home Screen"
```

## Run it locally (on a computer)

```bash
cd lucida
python3 -m http.server 8000
```

Then open http://localhost:8000. Browsers allow the camera on `localhost`, so it works on the computer itself.

**On your iPhone:** Safari only allows the camera over **https**, so `http://192.168.x.x:8000` won't get camera access. To test from the phone without deploying, start a free temporary HTTPS tunnel while the server is running:

```bash
# option A (no account): Cloudflare quick tunnel
brew install cloudflared            # once
cloudflared tunnel --url http://localhost:8000
# open the https://….trycloudflare.com address it prints, on your iPhone
```

## Deploy free (permanent https link)

All paths are relative, so the folder works as-is on any static host.

**GitHub Pages**
1. Create a free GitHub account and a new **public** repository, for example `lucida`.
2. On the repo page: **Add file → Upload files**. Drag in everything *inside* the `lucida` folder (`index.html`, `js/`, `icons/`, `sw.js`, `manifest.webmanifest`). Commit.
3. Go to **Settings → Pages**, set "Deploy from a branch", choose `main` and `/ (root)`, then Save.
4. After about a minute it's live at `https://YOUR-NAME.github.io/lucida/`.

**Cloudflare Pages:** dash.cloudflare.com → Workers & Pages → Create → Pages → *Upload assets*. Drag in the folder and you get a `*.pages.dev` address.

**Netlify:** app.netlify.com/drop. Drag in the folder and sign in (free) so the site stays up.

### On the iPhone
1. Open the https link in **Safari** and allow the camera.
2. Tap **Share → Add to Home Screen**. Launched from there, it runs full-screen with no browser bars and works offline.
3. If you ever denied camera access: tap **aA** in the address bar → Website Settings → Camera → Allow. Also check Settings → Safari → Camera.

To update the app, re-upload the changed files. The service worker is network-first, so the new version loads next time you open it.

## The 0.5× camera

On start, Lucida lists the iPhone's cameras and opens the **Back Ultra Wide (0.5×)** lens directly (it matches "ultra" in the lens name, so English and Spanish iOS both work).

- If any lens fails to open (for example a broken 1× camera), it tries the others, ultra-wide first.
- Your choice is remembered. You can switch lens in **Camera**.
- On "Auto (multi-lens)" devices that expose zoom, a zoom slider appears, starting at 0.5×.

Note: on the very first visit, before permission is granted, Safari opens its default rear camera for a moment (needed to read the lens names), then switches to 0.5×. After that it goes straight to 0.5×.

## Painting assistant: how it works

1. **CIELAB conversion** of every pixel (D65 sRGB → XYZ → L\*a\*b\*).
2. **SLIC superpixels** (Achanta et al.) in Lab space, then **edge-aware region merging**: neighbouring superpixels merge when their colour difference is small, and strong gradient boundaries resist merging. Value differences are weighted slightly higher. Region boundaries are then refined at full resolution, pixel by pixel.
3. **Per-region measurements:** mean colour (HEX/RGB/Lab), value class (normalised to the photo's tonal range), and highlights (only local peaks, not merely light areas). Also warm/cool temperature, and surface form from a least-squares plane fit of L\* (flat / curved / textured, plus which side is lighter).
4. **Colour families:** peaks of an area×chroma-weighted hue histogram. Each region also gets its position within its family's value range.
5. **Light direction:** a confidence-weighted vote of the shading gradients inside smoothly shaded regions. It reports "diffuse" when there's no consistent direction.
6. **Reflected light:** shadow-side regions that are lighter than an adjacent core shadow of the same colour, lie further from the light, and border a lighter surface.
7. **Transitions:** edges are soft or hard based on edge sharpness relative to the size of the colour step.
8. **Complementary underpainting decision, per region:** uses the artist's RYB wheel (pink → green, orange → blue, yellow → violet). A complement is applied only where a region is darker *and* less saturated than its family's lit colour. Strength scales with both. Lit areas stay pure, and saturated "glowing" darks get a deeper analogous colour instead of a complement.
9. **Plan:** the layer order depends on the medium. Transparent media (pencils, watercolour, markers) go light → dark and reserve the paper for highlights. Opaque media (gouache, acrylic, oil, pastel) go underpainting → darks → lights → highlights. Graphite works in values only. Every colour is matched to the colours you own with **CIEDE2000**, choosing the simplest option: a single colour, then one colour lighter (or diluted / with white), then a layered or mixed pair.

### Limits (honest version)
- Lucida analyses colour, value and shape. It **can't recognise objects** (it doesn't know a petal is a petal).
- Pressure, dilution, "underlayer visible %" and two-colour layer/mix ratios are **estimates** from simple optical models. Paper, pigment and technique change the result, so test on scrap paper first.
- Brand swatch values (Prismacolor Premier, Polychromos, paint pigments) are **approximate screen renderings** of a selection of each range. Untick colours you don't own, or build a **custom set** from your own swatch card for best accuracy.
- Light-direction confidence is shown. Flat, busy or heavily edited photos give weaker estimates.
- Analysis is about 2–5 seconds on a phone ("Detailed" takes longer). Results are cached per photo.

## Adding a pencil brand

Add an entry to `SETS` in `js/library.js`, for example `{ name, approx: true, colours: [{ code, name, hex }, …] }`. Then list its id in the `sets` array of the media that can use it.
