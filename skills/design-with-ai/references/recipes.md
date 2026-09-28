# CSS/Canvas Effect Recipes

Bundled from MengTo/Skills web-design collection. Each recipe is a self-contained effect.
Source: MengTo/Skills (https://github.com/MengTo/Skills), MIT License, Copyright (c) 2026 Meng To. Adapted 2026-07-09.

---

## Progressive Blur

Layered CSS backdrop-filter blur fading from a viewport edge. Use for top or bottom edge depth.

**When to use:** Page needs a blur overlay fading from the top or bottom edge. Ideal for nav backgrounds, footer fades, or scroll-cue depth.

**Usage checklist:**
- Insert `.gradient-blur` inside `<body>`.
- Keep it near the top of the DOM.
- Ensure content exists behind it (`backdrop-filter` blurs what is behind).
- Adjust `z-index` to sit above content but below modals.

### Top blur (from top)
```html
<div class="gradient-blur">
 <div></div><div></div><div></div><div></div><div></div><div></div>
</div>
<style>
 .gradient-blur {
 position: fixed; z-index: 5; inset: 0 0 auto 0; height: 12%; pointer-events: none;
 }
 .gradient-blur > div, .gradient-blur::before, .gradient-blur::after {
 position: absolute; inset: 0;
 }
 .gradient-blur::before {
 content: ""; z-index: 1; backdrop-filter: blur(0.5px);
 mask: linear-gradient(to top, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,0) 37.5%);
 }
 .gradient-blur > div:nth-of-type(1) { z-index: 2; backdrop-filter: blur(1px);
 mask: linear-gradient(to top, rgba(0,0,0,0) 12.5%, rgba(0,0,0,1) 25%, rgba(0,0,0,1) 37.5%, rgba(0,0,0,0) 50%); }
 .gradient-blur > div:nth-of-type(2) { z-index: 3; backdrop-filter: blur(2px);
 mask: linear-gradient(to top, rgba(0,0,0,0) 25%, rgba(0,0,0,1) 37.5%, rgba(0,0,0,1) 50%, rgba(0,0,0,0) 62.5%); }
 .gradient-blur > div:nth-of-type(3) { z-index: 4; backdrop-filter: blur(4px);
 mask: linear-gradient(to top, rgba(0,0,0,0) 37.5%, rgba(0,0,0,1) 50%, rgba(0,0,0,1) 62.5%, rgba(0,0,0,0) 75%); }
 .gradient-blur > div:nth-of-type(4) { z-index: 5; backdrop-filter: blur(8px);
 mask: linear-gradient(to top, rgba(0,0,0,0) 50%, rgba(0,0,0,1) 62.5%, rgba(0,0,0,1) 75%, rgba(0,0,0,0) 87.5%); }
 .gradient-blur > div:nth-of-type(5) { z-index: 6; backdrop-filter: blur(16px);
 mask: linear-gradient(to top, rgba(0,0,0,0) 62.5%, rgba(0,0,0,1) 75%, rgba(0,0,0,1) 87.5%, rgba(0,0,0,0) 100%); }
 .gradient-blur > div:nth-of-type(6) { z-index: 7; backdrop-filter: blur(32px);
 mask: linear-gradient(to top, rgba(0,0,0,0) 75%, rgba(0,0,0,1) 87.5%, rgba(0,0,0,1) 100%); }
 .gradient-blur::after { content: ""; z-index: 8; backdrop-filter: blur(64px);
 mask: linear-gradient(to top, rgba(0,0,0,0) 87.5%, rgba(0,0,0,1) 100%); }
</style>
```

### Bottom blur (from bottom)
Same structure -- change `inset: 0 0 auto 0` to `inset: auto 0 0 0`, height to `65%`, and all gradient directions from `to top` to `to bottom`.

**Tuning knobs:** Direction (flip `to top`/`to bottom`), Height (`%`), Strength (blur values 0.5px-64px), Steps (add/remove layers).

**Pitfalls:** `backdrop-filter` needs content behind it; will not blur flat background colors. High blur values are GPU-heavy.

---

## Dither Background

Procedural dark monochrome canvas background with enlarged square pixels and Bayer-style ordered dithering.

**When to use:** Dark interface needs atmospheric background with organic waves and square-pixel texture, behind framed UI or hero content.

```html
<canvas class="dither-background" data-dither-background></canvas>
```
```css
.dither-background { position: fixed; inset: 0; z-index: 0; width: 100vw; height: 100vh; background: #030303; pointer-events: none; }
.page-content { position: relative; z-index: 1; }
```

```js
const BAYER_4X4 = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5].map(v => (v + 0.5) / 16);

function smoothstep(e0, e1, v) {
 const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
 return t * t * (3 - 2 * t);
}
function noise2(x, y) { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123; return v - Math.floor(v); }
function valueNoise(x, y) {
 const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
 const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
 return noise2(ix,iy)*(1-ux)*(1-uy) + noise2(ix+1,iy)*ux*(1-uy) + noise2(ix,iy+1)*(1-ux)*uy + noise2(ix+1,iy+1)*ux*uy;
}
function fbm(x, y) {
 let v = 0, amp = 0.5, freq = 1;
 for (let i = 0; i < 4; i++) { v += valueNoise(x*freq, y*freq)*amp; freq *= 2.02; amp *= 0.5; }
 return v;
}

function initDitherBackground(canvas, options = {}) {
 if (!canvas) return () => {};
 const ctx = canvas.getContext("2d", { alpha: false });
 if (!ctx) return () => {};
 const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
 const cell = options.cellSize || 7, maxDpr = options.maxDpr || 1.5;
 let width = 1, height = 1, cols = 1, rows = 1, rafId = 0;
 const palette = options.palette || [[3,3,3],[16,16,17],[34,35,37],[74,75,78],[168,169,171],[236,236,232]];

 function resize() {
 const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
 width = Math.max(1, window.innerWidth); height = Math.max(1, window.innerHeight);
 canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
 canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
 ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
 cols = Math.ceil(width / cell); rows = Math.ceil(height / cell);
 }
 function sampleField(x, y, time) {
 const nx = (x/cols-0.5)*2, ny = (y/rows-0.5)*2;
 const dist = Math.sqrt(nx*nx*0.84 + ny*ny*1.28);
 const vignette = 1 - smoothstep(0.18, 1.15, dist);
 const drift = reduceMotion ? 0 : time * 0.018;
 const wave = Math.sin(nx*2.8+ny*1.2+drift)*0.18 + Math.sin(nx*-1.4+ny*3.8-drift*0.8)*0.14;
 const cloud = fbm(nx*1.35+drift*0.16, ny*1.35-drift*0.08);
 const ridge = smoothstep(0.48, 0.92, cloud + wave);
 const offAxis = smoothstep(0.98, 0.18, Math.hypot(nx+0.22, ny-0.08));
 return Math.max(0, Math.min(1, ridge*vignette*0.92 + offAxis*0.18));
 }
 function render(time = 0) {
 const s = time * 0.001;
 ctx.fillStyle = "rgb(3,3,3)"; ctx.fillRect(0, 0, width, height);
 for (let y = 0; y < rows; y++) {
 for (let x = 0; x < cols; x++) {
 const threshold = BAYER_4X4[(y%4)*4 + (x%4)];
 const brightness = sampleField(x, y, s);
 const stepped = Math.floor(Math.max(0, Math.min(0.999, brightness + threshold*0.18)) * palette.length);
 const color = palette[Math.min(palette.length-1, stepped)];
 ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
 ctx.fillRect(x*cell, y*cell, cell, cell);
 }
 }
 if (!reduceMotion) rafId = requestAnimationFrame(render);
 }
 function handleResize() { cancelAnimationFrame(rafId); resize(); render(); }
 resize(); render();
 window.addEventListener("resize", handleResize);
 return () => { cancelAnimationFrame(rafId); window.removeEventListener("resize", handleResize); };
}

const cleanupDither = initDitherBackground(
 document.querySelector("[data-dither-background]"),
 { cellSize: 7, maxDpr: 1.5 }
);
```

**Tuning:** `cellSize` 5-10px, monochrome palette only, slow drift multiplier, increase `cellSize` before simplifying field math for performance.

---

## CSS Border Gradient

Gradient border treatments for premium card, modal, panel, and hero surfaces.

**When to use:** Surface needs a more refined edge than a flat border. Dark glass, pricing panels, hero cards.

**Defaults:** 1px width, 135deg/160deg angle, neutral highlight + one brand accent + neutral fade, most stops < 0.4 opacity.

### Simple pattern (solid/translucent fill)
```css
.gradient-border {
 --surface: rgba(10, 14, 24, 0.72);
 --border-a: rgba(255, 255, 255, 0.34);
 --border-b: rgba(125, 92, 255, 0.36);
 --border-c: rgba(255, 255, 255, 0.08);
 border: 1px solid transparent;
 border-radius: 20px;
 background:
 linear-gradient(var(--surface), var(--surface)) padding-box,
 linear-gradient(135deg, var(--border-a), var(--border-b), var(--border-c)) border-box;
}
```

### Masked pattern (complex background behind)
```css
.gradient-border-mask { position: relative; border-radius: 20px; }
.gradient-border-mask::before {
 content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
 background: linear-gradient(145deg, rgba(255,255,255,0.34), rgba(125,92,255,0.36) 45%, rgba(255,255,255,0.08));
 -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
 -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none;
}
```

**Taste rules:** Apply to one hierarchy level at a time. No rainbow or full-saturation neon. The border should frame, not compete. Check both light and dark themes.

---

## Staggered Word Reveal

Word-by-word editorial text reveal triggered by IntersectionObserver. No GSAP required.

**When to use:** Short headline, intro, or pull quote should reveal word by word with a premium cinematic feel. Trigger once on enter.

**Motion defaults:** `opacity: 0` + `translateY(20px)` to visible, duration 0.8s, `cubic-bezier(0.16, 1, 0.3, 1)`, stagger 0.07s/word.

```html
<h1 class="word-reveal" data-word-reveal>
 Build interfaces that feel calm, cinematic, and alive.
</h1>
```

```css
.word-reveal { visibility: visible; }
html.js .word-reveal[data-word-reveal]:not(.is-ready) { opacity: 0; }
.word-reveal__word {
 display: inline-block; opacity: 0; transform: translate3d(0, 20px, 0);
 transition: opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1);
 transition-delay: calc(var(--word-index) * 0.07s); will-change: opacity, transform;
}
.word-reveal.is-visible .word-reveal__word { opacity: 1; transform: translate3d(0,0,0); }
@media (prefers-reduced-motion: reduce) {
 html.js .word-reveal[data-word-reveal]:not(.is-ready), .word-reveal__word {
 opacity: 1; transform: none; transition: none;
 }
}
```

```js
document.documentElement.classList.add("js");

function splitWordReveal(element) {
 if (element.dataset.wordRevealReady === "true") return;
 const text = element.textContent || "";
 const parts = text.split(/(\s+)/);
 let wordIndex = 0;
 element.textContent = "";
 element.setAttribute("aria-label", text.trim());
 parts.forEach(part => {
 if (!part.trim()) { element.appendChild(document.createTextNode(part)); return; }
 const span = document.createElement("span");
 span.className = "word-reveal__word";
 span.setAttribute("aria-hidden", "true");
 span.style.setProperty("--word-index", wordIndex);
 span.textContent = part;
 element.appendChild(span);
 wordIndex++;
 });
 element.dataset.wordRevealReady = "true";
 element.classList.add("is-ready");
}

function initWordReveals(selector = "[data-word-reveal]") {
 const elements = Array.from(document.querySelectorAll(selector));
 const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
 if (reduceMotion || !("IntersectionObserver" in window)) {
 elements.forEach(el => el.classList.add("is-ready", "is-visible")); return;
 }
 const observer = new IntersectionObserver((entries, io) => {
 entries.forEach(entry => {
 if (!entry.isIntersecting) return;
 entry.target.classList.add("is-visible");
 io.unobserve(entry.target);
 });
 }, { threshold: 0.2, rootMargin: "0px 0px -10% 0px" });
 elements.forEach(el => { splitWordReveal(el); observer.observe(el); });
}
document.addEventListener("DOMContentLoaded", () => initWordReveals());
```

**Framework notes:** React/Vue/Svelte: run splitter after mount, clean up observer on route changes. Framer Motion: `y: 20`, `opacity: 0`, duration `0.8`, ease `[0.16,1,0.3,1]`, stagger `0.06-0.08`, `once: true`. GSAP: `fromTo(words, {y:20, opacity:0}, {y:0, opacity:1, duration:0.8, ease:"expo.out", stagger:0.07})`.

**Taste rules:** Short text only (headlines, subheads, quotes). Stagger words not letters. No bounce, rotation, or large blur. Do not split text with inline links or buttons.

---

## Framed Grid Layout

Minimal grid with thin visible boundary lines, L-shaped corner brackets, diagonal texture, and strict alignment.

**When to use:** Design needs clean technical structure with visible section boundaries -- editorial, system-like, guide-border layouts.

```css
:root {
 --fg-bg: #f7f7f4; --fg-surface: rgba(255,255,255,0.62);
 --fg-line: rgba(24,24,27,0.14); --fg-line-strong: rgba(24,24,27,0.34);
 --fg-texture: rgba(24,24,27,0.035); --fg-gap: 16px;
 --fg-pad: clamp(16px, 2vw, 28px); --fg-corner: 18px;
}
.framed-grid {
 min-height: 100vh; padding: var(--fg-gap);
 background:
 repeating-linear-gradient(135deg, transparent 0 11px, var(--fg-texture) 11px 12px),
 var(--fg-bg);
 display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--fg-gap);
}
.frame { position: relative; border: 1px solid var(--fg-line); background: var(--fg-surface); padding: var(--fg-pad); overflow: hidden; }
.frame-brackets {
 background:
 linear-gradient(var(--fg-line-strong),var(--fg-line-strong)) left top / var(--fg-corner) 1px no-repeat,
 linear-gradient(var(--fg-line-strong),var(--fg-line-strong)) left top / 1px var(--fg-corner) no-repeat,
 linear-gradient(var(--fg-line-strong),var(--fg-line-strong)) right top / var(--fg-corner) 1px no-repeat,
 linear-gradient(var(--fg-line-strong),var(--fg-line-strong)) right top / 1px var(--fg-corner) no-repeat,
 linear-gradient(var(--fg-line-strong),var(--fg-line-strong)) left bottom / var(--fg-corner) 1px no-repeat,
 linear-gradient(var(--fg-line-strong),var(--fg-line-strong)) left bottom / 1px var(--fg-corner) no-repeat,
 linear-gradient(var(--fg-line-strong),var(--fg-line-strong)) right bottom / var(--fg-corner) 1px no-repeat,
 linear-gradient(var(--fg-line-strong),var(--fg-line-strong)) right bottom / 1px var(--fg-corner) no-repeat,
 var(--fg-surface);
}
.span-12 { grid-column: span 12; } .span-8 { grid-column: span 8; }
.span-6 { grid-column: span 6; } .span-4 { grid-column: span 4; }
@media (max-width: 760px) {
 .framed-grid { grid-template-columns: 1fr; }
 .span-12, .span-8, .span-6, .span-4 { grid-column: 1 / -1; }
}
```

```html
<main class="framed-grid">
 <section class="frame frame-brackets span-12">...</section>
 <section class="frame frame-brackets span-8">...</section>
 <aside class="frame frame-brackets span-4">...</aside>
</main>
```

**Rules:** One border color, one corner size, one spacing scale. Texture < 0.05 opacity. No heavy shadows. No mixed border weights in adjacent frames.

---

## Corner Diagonals

Diagonal-cut corners and chamfered edges using `clip-path: polygon()` for buttons, cards, and panels.

**When to use:** Design needs geometric framing, sci-fi UI surfaces, clipped-corner controls, or engineered sharp containers.

```css
:root {
 --corner-cut-sm: 8px; --corner-cut-md: 14px; --corner-cut-lg: 24px;
 --corner-line: rgba(255,255,255,0.18); --corner-line-strong: rgba(255,255,255,0.34);
 --corner-fill: rgba(10,14,24,0.82); --corner-accent: #8b5cf6;
}

/* All four corners */
.cut-all {
 --cut: var(--corner-cut-md);
 clip-path: polygon(
 var(--cut) 0, calc(100% - var(--cut)) 0,
 100% var(--cut), 100% calc(100% - var(--cut)),
 calc(100% - var(--cut)) 100%, var(--cut) 100%,
 0 calc(100% - var(--cut)), 0 var(--cut)
 );
}

/* Top-left + bottom-right */
.cut-top-left-bottom-right {
 --cut: var(--corner-cut-md);
 clip-path: polygon(
 var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)),
 calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut)
 );
}

/* Bordered shell with diagonal gradient edge */
.cut-shell {
 --cut: var(--corner-cut-md); --border-size: 1px;
 position: relative; padding: var(--border-size);
 background: linear-gradient(135deg, var(--corner-line-strong), transparent 46%, var(--corner-line));
 clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
}
.cut-shell__inner {
 min-height: 100%; padding: clamp(16px,2.4vw,28px);
 background: var(--corner-fill); clip-path: inherit;
}

/* Primary button */
.cut-button {
 --cut: var(--corner-cut-sm);
 display: inline-flex; min-height: 44px; align-items: center; justify-content: center;
 gap: 8px; padding: 0 18px; border: 0; color: white;
 background: linear-gradient(135deg, var(--corner-accent), color-mix(in srgb, var(--corner-accent), black 28%));
 clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
}
.cut-button:focus-visible { outline: 2px solid color-mix(in srgb, var(--corner-accent), white 45%); outline-offset: 3px; }
```

**Tuning:** Cut size 6-10px for controls, 12-18px for cards, 20-32px for panels. Reuse same polygon family across components.

**Avoid:** Random cut sizes, mixing rounded pills with chamfered geometry, clipping only the background while borders stay rectangular.

---

## Beautiful Shadows

Exact Tailwind arbitrary shadow utilities for polished layered neutral elevation.

**When to use:** Default Tailwind shadows feel too generic. Cards, popovers, hero media need refined depth without colored glow.

### beautiful-sm (compact cards, form controls, pills)
```txt
shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.1),0px_1px_0px_0px_rgba(25,28,33,0.02),0px_0px_0px_1px_rgba(25,28,33,0.08)]
```

### beautiful-md (cards, panels, popovers -- default elevated surface)
```txt
shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_1px_-0.5px_rgba(0,0,0,0.06),0px_3px_3px_-1.5px_rgba(0,0,0,0.06),_0px_6px_6px_-3px_rgba(0,0,0,0.06),0px_12px_12px_-6px_rgba(0,0,0,0.06),0px_24px_24px_-12px_rgba(0,0,0,0.06)]
```

### beautiful-lg (hero media, feature callouts, modals)
```txt
shadow-[0_2.8px_2.2px_rgba(0,_0,_0,_0.034),_0_6.7px_5.3px_rgba(0,_0,_0,_0.048),_0_12.5px_10px_rgba(0,_0,_0,_0.06),_0_22.3px_17.9px_rgba(0,_0,_0,_0.072),_0_41.8px_33.4px_rgba(0,_0,_0,_0.086),_0_100px_80px_rgba(0,_0,_0,_0.12)]
```

**Rules:** One shadow strength per component state. Neutral only -- no color tinting. Do not mix with default Tailwind shadow scales on the same component.

---

## CSS Alpha Masking

Edge-fade using `mask-image` gradient for horizontal or vertical fades.

**When to use:** Element needs an alpha fade at its edges (marquee edges, image blends, container fades).

```css
/* Horizontal fade (left/right) */
mask-image: linear-gradient(to right, transparent, black 15%, black 85%, transparent);
-webkit-mask-image: linear-gradient(to right, transparent, black 15%, black 85%, transparent);

/* Vertical fade (top/bottom) */
mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent);
-webkit-mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent);
```

**Tuning:** Direction (`to right`, `to left`, `to bottom`, `to top`), fade depth (adjust `15%`/`85%`), strength (change `transparent` to `rgba(0,0,0,0.2)` for softer fade).

**Always include** `-webkit-mask-image` for Safari.

---

## Marquee Loop

Seamless infinite marquee using duplicated items and CSS `transform` animation.

**When to use:** Logos, testimonials, tags, or feature chips need an infinite seamless loop.

```html
<div class="marquee-wrapper">
 <div class="marquee-track">
 <!-- Duplicate the full item list so end + beginning match -->
 <div class="marquee-item">Item A</div>
 <div class="marquee-item">Item B</div>
 <div class="marquee-item">Item C</div>
 <!-- ...same items again... -->
 <div class="marquee-item">Item A</div>
 <div class="marquee-item">Item B</div>
 <div class="marquee-item">Item C</div>
 </div>
</div>
```

```css
.marquee-wrapper {
 overflow: hidden;
 /* Apply alpha mask at edges: */
 mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
 -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
}
.marquee-track {
 display: flex; gap: 2rem;
 animation: marquee-scroll 30s linear infinite;
 width: max-content;
}
@keyframes marquee-scroll {
 from { transform: translateX(0); }
 to { transform: translateX(-50%); }
}
.marquee-track:hover { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
 .marquee-track { animation: none; }
}
```

**Rules:** Keep item widths stable to prevent jumps. Pause on hover only when interaction is useful. Max one marquee per page. Do not use heavy shadows or filters on moving items.

---

## Number Details

Decorative 01/02/03 numeric markers for process steps, feature groups, or editorial rhythm.

**When to use:** Section needs subtle two-digit markers as secondary visual structure.

```css
.step-number {
 font-variant-numeric: tabular-nums;
 font-feature-settings: "tnum";
 font-size: 0.65rem;
 letter-spacing: 0.1em;
 text-transform: uppercase;
 color: rgba(0, 0, 0, 0.28); /* Low contrast -- architectural, not content */
 font-weight: 500;
}
```

```html
<div class="feature-card">
 <span class="step-number">01</span>
 <h3>Feature name</h3>
 <p>Description</p>
</div>
```

**Rules:** Use two-digit numbers (01, 02, 03) for consistency. Place in card corners, section gutters, or beside headings. Low contrast so numbers feel architectural. Do not mix numbering styles within a section. Do not let numbers compete with headings or CTAs.

---

## Nested Container Frames

Container-in-container layout system with outer bounds, inset inner frames, and layered page structure.

**When to use:** Layout needs a visible outer frame with inset inner sections for hero, features, proof, and CTA -- without heavy cards.

```html
<div class="outer-frame">
 <!-- Outer establishes global width + visible boundary lines -->
 <div class="inner-frame inner-frame--hero">
 <!-- Hero content -->
 </div>
 <div class="inner-frame inner-frame--features">
 <!-- Feature content -->
 </div>
</div>
```

```css
.outer-frame {
 max-width: 1200px; margin: 0 auto;
 border-left: 1px solid rgba(0,0,0,0.1);
 border-right: 1px solid rgba(0,0,0,0.1);
 padding: 0 clamp(16px, 3vw, 40px);
}
.inner-frame {
 border: 1px solid rgba(0,0,0,0.08);
 border-radius: 12px;
 background: rgba(255,255,255,0.5);
 padding: clamp(20px, 3vw, 48px);
 margin-block: 16px;
}
```

**Rules:** Outer container controls global page width; inner containers are inset from outer edges with consistent padding. Give each level its own background and border. Do not nest more than two frame levels or the layout feels boxed in. Frame lines must not overpower content readability.

---

## Company Logos

Consistent brand mark rendering using Iconify Simple Icons.

**When to use:** Logo rows, integrations grids, customer proof, partner lists, or tool badges.

```html
<!-- Using Iconify web component -->
<script src="https://code.iconify.design/iconify-icon/1.0.8/iconify-icon.min.js"></script>

<div class="logo-row">
 <iconify-icon icon="simple-icons:stripe" width="64" height="64"></iconify-icon>
 <iconify-icon icon="simple-icons:github" width="64" height="64"></iconify-icon>
 <iconify-icon icon="simple-icons:figma" width="64" height="64"></iconify-icon>
</div>
```

```css
.logo-row {
 display: flex; align-items: center; gap: 2rem; flex-wrap: wrap;
}
.logo-row iconify-icon {
 color: currentColor; opacity: 0.5; /* Monochrome default */
 transition: opacity 0.2s;
}
.logo-row iconify-icon:hover { opacity: 0.85; }
```

**Rules:** Use Iconify Simple Icons as default source. Keep logos monochrome unless brand recognition requires color. Align to a shared baseline or center grid. Add accessible labels when logos are interactive. Do not mix filled, outline, emoji, bitmap, and wordmark styles in one row. Do not hotlink logos from search results.

---

## Gooey Blob System

SVG filter-driven gooey blob system where multiple shapes merge into a fluid organic form.

**When to use:** Page needs organic fluid shapes that visually merge, separate, and move as one soft system (hero background, loader, cursor field).

```html
<div class="gooey-container">
 <svg style="position:absolute;width:0;height:0">
 <defs>
 <filter id="gooey">
 <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
 <feColorMatrix in="blur" mode="matrix"
 values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 20 -10" result="gooey" />
 </filter>
 </defs>
 </svg>
 <div class="gooey-wrapper">
 <div class="blob blob-1"></div>
 <div class="blob blob-2"></div>
 <div class="blob blob-3"></div>
 </div>
</div>
```

```css
.gooey-wrapper {
 filter: url(#gooey);
 position: relative; width: 400px; height: 400px;
}
.blob {
 position: absolute; border-radius: 50%;
 background: #6366f1; /* or currentColor */
 width: 120px; height: 120px;
 animation: blob-float 4s ease-in-out infinite;
}
.blob-1 { top: 30%; left: 30%; animation-delay: 0s; }
.blob-2 { top: 40%; left: 50%; animation-delay: 1.2s; width: 100px; height: 100px; }
.blob-3 { top: 50%; left: 35%; animation-delay: 2.4s; width: 80px; height: 80px; }

@keyframes blob-float {
 0%, 100% { transform: translate(0, 0) scale(1); }
 33% { transform: translate(20px, -15px) scale(1.05); }
 66% { transform: translate(-10px, 10px) scale(0.95); }
}

@media (prefers-reduced-motion: reduce) {
 .blob { animation: none; }
}
```

**Tuning:** `stdDeviation` controls blur intensity; `feColorMatrix` values row 4 controls merge threshold (higher = tighter merge). Keep shapes slow and smooth. Use as background accent only -- do not cover primary content.

**Rules:** Build effect with SVG filters (blur + threshold), not plain blurred circles. Keep motion smooth and cohesive. Provide static fallback for reduced-motion contexts.

---

## Container Lines

Vertical guide lines at the content-container edges plus optional mini corner squares. Use when a hero or product page feels loose and needs quiet structural tension (editorial/tech framing).

**Source skill:** MengTo `container-lines` (added 2026-07-15).

```css
:root {
 --container-max: 1120px;
 --container-pad: clamp(20px, 4vw, 48px);
 --line-color: rgba(24, 24, 27, 0.14);
 --line-strong: rgba(24, 24, 27, 0.28);
 --corner-size: 6px;
}

.container-lines {
 position: relative;
 isolation: isolate;
}

.container-lines::before,
.container-lines::after {
 content: "";
 position: absolute;
 top: 0;
 bottom: 0;
 z-index: -1;
 width: 1px;
 background: var(--line-color);
 pointer-events: none;
}

.container-lines::before {
 left: max(var(--container-pad), calc((100vw - var(--container-max)) / 2));
}

.container-lines::after {
 right: max(var(--container-pad), calc((100vw - var(--container-max)) / 2));
}

.corner-squares {
 position: relative;
}

.corner-squares > .corner {
 position: absolute;
 width: var(--corner-size);
 height: var(--corner-size);
 background: var(--line-strong);
 pointer-events: none;
}

.corner.top-left {
 top: 0;
 left: 0;
 transform: translate(-50%, -50%);
}
.corner.top-right {
 top: 0;
 right: 0;
 transform: translate(50%, -50%);
}
.corner.bottom-left {
 bottom: 0;
 left: 0;
 transform: translate(-50%, 50%);
}
.corner.bottom-right {
 bottom: 0;
 right: 0;
 transform: translate(50%, 50%);
}

.content-container {
 width: min(100% - (var(--container-pad) * 2), var(--container-max));
 margin-inline: auto;
}
```

```html
<main class="container-lines">
 <section class="corner-squares content-container">
 <span class="corner top-left"></span>
 <span class="corner top-right"></span>
 <span class="corner bottom-left"></span>
 <span class="corner bottom-right"></span>
 <!-- content -->
 </section>
</main>
```

**Rules:** Lines organize, they do not decorate. Keep them page/section-level only. Share max-width + padding between content and guides. Dark mode: raise line opacity slightly or use `color-mix`.

---

## Masked Word Reveal (GSAP)

Word-by-word rise through an overflow mask on scroll. Prefer for short headlines/section intros (editorial). Distinct from plain opacity stagger: each word is clipped by a mask so motion reads as “pushing through.”

**Source skill:** MengTo `masked-reveal` (added 2026-07-15). Requires GSAP + ScrollTrigger.

**Defaults:** start `top 82%`, duration `0.8s`, stagger `0.035s`, `yPercent: 110 → 0`, ease `power3.out`, once.

```css
.masked-reveal {
 visibility: visible;
}

html.js .masked-reveal[data-masked-reveal] {
 visibility: hidden;
}

html.js .masked-reveal.is-split {
 visibility: visible;
}

.masked-reveal .word-mask {
 display: inline-block;
 overflow: hidden;
 vertical-align: top;
}

.masked-reveal .word {
 display: inline-block;
 transform: translateY(110%);
 will-change: transform;
}

@media (prefers-reduced-motion: reduce) {
 html.js .masked-reveal[data-masked-reveal] {
 visibility: visible;
 }
 .masked-reveal .word {
 transform: none;
 }
}
```

```js
document.documentElement.classList.add("js");
gsap.registerPlugin(ScrollTrigger);

function escapeHTML(value) {
 return value
 .replace(/&/g, "&amp;")
 .replace(/</g, "&lt;")
 .replace(/>/g, "&gt;")
 .replace(/"/g, "&quot;")
 .replace(/'/g, "&#039;");
}

function splitMaskedReveal(element) {
 if (element.dataset.maskedRevealReady === "true") return;
 const text = element.textContent.trim();
 element.setAttribute("aria-label", text);
 element.innerHTML = text
 .split(/(\s+)/)
 .map((part) => {
 if (!part.trim()) return part;
 return `<span class="word-mask" aria-hidden="true"><span class="word">${escapeHTML(part)}</span></span>`;
 })
 .join("");
 element.dataset.maskedRevealReady = "true";
 element.classList.add("is-split");
}

function initMaskedReveals(selector = "[data-masked-reveal]") {
 if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
 document.querySelectorAll(selector).forEach((element) => {
 splitMaskedReveal(element);
 const words = element.querySelectorAll(".word");
 gsap.set(element, { autoAlpha: 1 });
 gsap.fromTo(
 words,
 { yPercent: 110 },
 {
 yPercent: 0,
 duration: 0.8,
 ease: "power3.out",
 stagger: 0.035,
 scrollTrigger: { trigger: element, start: "top 82%", once: true },
 }
 );
 });
}

initMaskedReveals();
```

React: wrap in `gsap.context` inside `useLayoutEffect` and `ctx.revert()` on cleanup.

**Rules:** Short text only. Stagger by word, not letter. `aria-label` preserves SR text. No split of links/buttons. Reduced-motion → static.

---

## Glass Dark Panel

Frosted dark surfaces with readable contrast and a masked gradient border. Use for dark heroes, dashboards, modals - not as default on every card.

**Source skill:** MengTo `glass-dark-ui` (added 2026-07-15). Complements **CSS Border Gradient** with full panel tokens.

```css
:root {
 --bg-0: #020617;
 --glass-fill: rgba(15, 23, 42, 0.45);
 --glass-fill-strong: rgba(15, 23, 42, 0.62);
 --text-main: #e2e8f0;
 --text-muted: #94a3b8;
 --accent: #60a5fa;
}

.glass-panel {
 background: linear-gradient(
 180deg,
 rgba(255, 255, 255, 0.08),
 rgba(255, 255, 255, 0.02)
 );
 background-color: var(--glass-fill);
 border-radius: 16px; /* prefer 12-16px; avoid 24px+ “AI bubble” */
 box-shadow:
 0 20px 48px rgba(2, 6, 23, 0.45),
 inset 0 1px 0 rgba(255, 255, 255, 0.12);
 backdrop-filter: blur(18px) saturate(140%);
 -webkit-backdrop-filter: blur(18px) saturate(140%);
 color: var(--text-main);
}

.glass-panel.border-gradient {
 position: relative;
}

.glass-panel.border-gradient::before {
 content: "";
 position: absolute;
 inset: 0;
 border-radius: inherit;
 padding: 1px;
 pointer-events: none;
 background: linear-gradient(
 145deg,
 rgba(148, 163, 184, 0.28) 0%,
 color-mix(in oklab, var(--accent) 40%, transparent) 50%,
 rgba(148, 163, 184, 0.18) 100%
 );
 -webkit-mask:
 linear-gradient(#fff 0 0) content-box,
 linear-gradient(#fff 0 0);
 -webkit-mask-composite: xor;
 mask-composite: exclude;
}

@supports not ((backdrop-filter: blur(1px))) {
 .glass-panel {
 background-color: var(--glass-fill-strong);
 }
}
```

**Rules:** Body text ≥ `#cbd5e1` on glass. No pure black scrims. Limit glow. Visible focus rings. Prefer brand accent over purple glow. Use sparingly - glass as default is a tell.
