# Core Web Vitals Session — Script & Slide Plan

Live demo tool: Web Performance Lab (`bun server.js`, http://localhost:3000).
Use `/lab/` for the interactive dashboard + inject controls, and the raw
`/test/*` and `?w=&s=` params (see README) for scripted, repeatable demos.

Keep two windows open throughout: the browser tab under test, and Chrome
DevTools (Performance panel + Lighthouse tab) alongside it.

---

## Agenda (slide 2)

1. Why these metrics exist (Core Web Vitals, real-world impact)
2. FCP — First Contentful Paint
3. LCP — Largest Contentful Paint
4. CLS — Cumulative Layout Shift
5. TBT — Total Blocking Time
6. SI — Speed Index
7. Recap + thresholds cheat sheet

---

## Slide 3 — Why this matters

**Talking points:**
- Core Web Vitals are Google's proxy for "does this page *feel* fast to a
  human," not just "does it finish loading."
- Directly affects bounce rate, conversion, and (for LCP/CLS/INP) search
  ranking.
- Each metric isolates a different failure mode — a page can ace one and
  fail another, so you need all of them.

**Cheat sheet table (good/needs-improvement/poor):**

| Metric | Good | Needs improvement | Poor |
|--------|------|--------------------|------|
| FCP | ≤ 1.8s | ≤ 3.0s | > 3.0s |
| LCP | ≤ 2.5s | ≤ 4.0s | > 4.0s |
| TBT | ≤ 200ms | ≤ 600ms | > 600ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| SI | ≤ 3.4s | ≤ 5.8s | > 5.8s |

---

## FCP — First Contentful Paint

### Slide: Definition

- Time from navigation start to the browser painting the **first** bit of
  DOM content (text, image, canvas, SVG — not the background or `<html>`
  itself).
- Answers: "did anything happen yet?" It's the user's first evidence the
  page is alive.
- Killed mostly by: slow TTFB, render-blocking CSS/JS in `<head>`.

### Script (say this while demoing)

> "FCP is the *first paint*, so anything that delays parsing or blocks
> rendering before that first paint pushes FCP back. Let's prove it two
> ways: first by slowing the document itself, then by blocking it with a
> synchronous script."

**Demo 1 — slow the HTML response itself (TTFB → FCP):**

```
http://localhost:3000/?w=0
http://localhost:3000/?w=1500
http://localhost:3000/?w=3000
```

Reload between each, watch the Performance panel / Lighthouse FCP number
move roughly in lockstep with `w`, because nothing can paint before the
document itself arrives.

**Demo 2 — render-blocking script in `<head>`:**

Open `/lab/`, use the Inject panel:

| Type | Wait (w) | Size (s) |
|------|----------|----------|
| Script (blocking, in `<head>`) | 0 | 0 |
| Script (blocking, in `<head>`) | 1500 | 300000 |

Same page, same content — only the injected `<script src="/test/script.js?w=1500&s=300000">`
in `<head>` changed. Because it's a classic blocking `<script>` (no `async`/
`defer`), the parser stops, fetches it, executes it, *then* continues to the
visible content. FCP shifts by ~1.5s even though nothing in the visible
markup changed.

**Fix / contrast:** switch the same injection to "Script (async)" and
re-run — FCP should return close to baseline, because the parser no longer
blocks on the download.

**Wrap-up line:** "FCP is a parser-blocking story: TTFB sets the floor,
render-blocking `<head>` resources push it further out."

---

## LCP — Largest Contentful Paint

### Slide: Definition

- Time until the **largest visible** content element (image, video poster,
  block-level text) is painted.
- The single most-watched Core Web Vital because it approximates "when did
  the main thing the user came for show up."
- The LCP element can *change* during load — the browser keeps re-evaluating
  until the user interacts or the page is fully loaded.

### Script

> "LCP isn't just about downloading the image fast — it's about *when it
> becomes visible*. We'll see three separate levers: raw download time,
> preloading, and visibility timing controlled by JS."

**Demo 1 — big vs. slow LCP image (raw download time):**

On `/lab/`, use the presets:

- "big LCP image" → `/test/image.png?w=0&s=500000`
- "slow LCP image" → `/test/image.png?w=2000&s=500000`

Same byte size, but the 2000ms artificial delay pushes LCP back by ~2s.
Point out in the Performance panel that the LCP marker lines up with the
image's paint, not its request start.

**Demo 2 — `preload` as the fix for a late-discovered LCP image:**

Explain the problem first: if the LCP image is only discoverable after CSS/
JS runs (e.g. a `background-image` set by a stylesheet, or an `<img>` added
by JS), the browser's preload scanner can't find it early, so it starts
downloading late no matter how fast the asset itself is.

Show the fix by adding this to `<head>` in `public/lab/index.html` (or a
scratch copy) pointing at the same test image:

```html
<link rel="preload" as="image" href="/test/image.png?w=0&s=500000" />
```

Re-run with and without the `<link rel="preload">` while keeping the image
discovery artificially late (e.g. reference it only via a stylesheet
`background-image` or inject it after other head resources) — with preload,
the browser fetches it during the preload scan instead of waiting for CSS/JS
to reveal it, so LCP comes in earlier.

**Demo 3 — image hidden, then revealed by JS (visibility controls the LCP timestamp):**

This is the one that surprises people: an element only counts toward LCP
once it's actually rendered/visible, not when it's requested or even
decoded.

```html
<img id="heroImg" src="/test/image.png?w=0&s=400000"
     style="visibility:hidden" width="800" height="400" />
<script>
  setTimeout(() => {
    document.getElementById('heroImg').style.visibility = 'visible';
  }, 2500);
</script>
```

Even though the image finishes downloading almost immediately, LCP won't
fire for it until the `visibility:visible` flip at 2.5s — because that's
the first frame it's actually painted. Contrast with `display:none` →
`display:block`, which behaves the same way. This is a common real-world
bug: image carousels / tab panels / cookie-banner-covered heroes that
"finish loading" early but paint late.

**Wrap-up line:** "LCP tracks paint time, not fetch time — download speed,
early discoverability (preload), and actual visibility all gate it
independently."

---

## CLS — Cumulative Layout Shift

### Slide: Definition

- Sum of "shift scores" for every unexpected layout shift during the page's
  lifetime (impact fraction × distance fraction), for shifts not caused by
  user input within 500ms.
- Purely about visual stability — a page can be fast (good FCP/LCP) and
  still feel broken if content jumps around while loading.

### Script

> "CLS is almost always one root cause: the browser had to lay something out
> before it knew that element's final size. Classic case — images without
> reserved dimensions."

**Demo — image without `width`/`height` (or `aspect-ratio`):**

Temporarily edit `public/lab/index.html`'s render area, or a scratch page,
to compare:

```html
<!-- BAD: no dimensions reserved, causes shift when image loads -->
<p>Some text above the image.</p>
<img src="/test/image.png?w=1000&s=300000" alt="test" />
<p>Some text below the image that gets pushed down.</p>
```

```html
<!-- GOOD: width/height (or aspect-ratio) reserve the box up front -->
<p>Some text above the image.</p>
<img src="/test/image.png?w=1000&s=300000" alt="test" width="800" height="400" />
<p>Some text below the image.</p>
```

Use `?w=1000` so the shift is slow enough to see with the naked eye, not
just in the trace. Open DevTools → Rendering → "Layout Shift Regions" to
visualize the shifted box in blue. Watch the CLS metric card on `/lab/` jump
from ~0 to a nonzero value only on the BAD version.

**Other CLS factors worth a mention slide (no live demo needed):**
- Web fonts swapping in with different metrics (FOIT/FOUT) → use
  `font-display: optional` or `size-adjust`.
- Ads/embeds injected without a reserved slot.
- Content inserted above existing content (e.g. a banner sliding in at the
  top) — reserve space or animate via `transform` instead of pushing layout.

**Wrap-up line:** "Every CLS fix is the same shape: tell the browser the
final size *before* it has to guess."

---

## TBT — Total Blocking Time

### Slide: Definition

- Sum of the "blocking portion" (time over 50ms) of every long task between
  FCP and Time to Interactive.
- Proxy for "how unresponsive did the page feel" — high TBT means clicks/
  taps queue up behind JS instead of being handled immediately.
- Tasks under 50ms never count, no matter how many of them there are — this
  is the whole trick behind the fix.

### Script

> "TBT punishes *long* tasks specifically, not total JS work. We can prove
> that by running the exact same amount of work two ways: as one big
> blocking chunk, and as many small yielding chunks."

**Demo 1 — a dummy long task that tanks TBT:**

Add this script (inject via `/lab/`'s "Script (blocking, in `<head>`)" with
w=0/s=0, then paste this logic into `public/lab/script.js` temporarily, or
just paste into DevTools console right after load):

```js
function blockMainThread(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // busy loop — deliberately starves the main thread
  }
}
blockMainThread(2000); // one 2000ms long task
```

Watch the TBT metric card and the Performance panel's "Long Tasks" track —
you'll see one solid red block, and TBT jumps by roughly `2000 - 50`ms
(the part of the task past the 50ms threshold).

**Demo 2 — the fix: chunk the work so no single task exceeds 50ms:**

```js
function blockMainThreadChunked(totalMs, chunkMs = 30) {
  let remaining = totalMs;
  function runChunk() {
    const end = performance.now() + Math.min(chunkMs, remaining);
    while (performance.now() < end) {
      // same total work, just sliced
    }
    remaining -= chunkMs;
    if (remaining > 0) {
      setTimeout(runChunk, 0); // yield back to the browser between chunks
    }
  }
  runChunk();
}
blockMainThreadChunked(2000, 30);
```

Same total CPU time (2000ms), but TBT drops close to 0 because every
individual task is under the 50ms threshold and the browser can interleave
input handling between chunks. Point out: total work done didn't change —
only *how it's scheduled* did. In real code this is what `scheduler.yield()`
/ `requestIdleCallback` / breaking up array processing into batches
accomplishes.

**Wrap-up line:** "TBT isn't 'reduce JS,' it's 'don't monopolize the main
thread for more than 50ms at a stretch' — scheduling, not just size."

---

## SI — Speed Index

### Slide: Definition

- Measures how quickly the page's content is *visually* populated over
  time — literally the area above the visual-completeness curve captured
  from a filmstrip of the load.
- Lower is better; a page that paints 100% of its final look immediately
  scores near 0, one that dribbles content in slowly scores high even if
  its *final* FCP/LCP numbers look fine.
- Only measurable via Lighthouse / WebPageTest (frame-by-frame visual
  capture) — there's no `PerformanceObserver` entry for it, unlike the
  other four.

### Script

> "SI is the only metric here about the *shape* of the loading experience,
> not a single instant. Two pages can have identical LCP and totally
> different SI depending on whether content appears all at once near the
> end, or progressively throughout."

**Demo — compare progressive vs. "big bang" rendering:**

Run Lighthouse (or WebPageTest) against two variants of `/lab/`:

1. **Baseline** — no injected assets, content renders normally as HTML
   parses.
2. **Big-bang** — inject one large render-blocking stylesheet
   (`Stylesheet`, w=1500, s=50000) so *nothing* below the fold paints until
   very late, then everything appears at once.

Both may end up with a similar LCP (whatever the last big element is), but
the big-bang version's SI is noticeably worse — the filmstrip shows a blank
page for 1.5s, then a full page snap-in, vs. the baseline's steady
progressive paint. Show the Lighthouse filmstrip view side by side — this
is the most visual, easiest-to-sell-a-room slide in the whole talk.

**Wrap-up line:** "SI rewards progressive rendering — showing *something*
early and filling in, rather than making users stare at blank space until
everything is ready at once."

---

## Recap slide (final)

- **FCP** — did anything show up? (parser/TTFB-bound)
- **LCP** — did the *main* thing show up? (download + discoverability +
  visibility-bound)
- **CLS** — did it stay put while showing up? (reserved-space-bound)
- **TBT** — could the user *interact* while it showed up? (main-thread
  scheduling-bound)
- **SI** — did it show up *gradually and quickly*, or all at once at the
  end? (visual-completeness-over-time-bound)

Closing line: "Every one of these has the same demo pattern we just ran:
take something away (delay it, hide its size, block the thread, hide it
behind JS) and watch the specific metric — and only that metric — move.
That's how you diagnose these in the wild, too: change one variable, watch
which Core Web Vital reacts."

---

## Appendix — quick reference of every URL/snippet used

```
# FCP
http://localhost:3000/?w=0|1500|3000
/lab/ inject: Script (blocking) w=1500 s=300000  vs  Script (async) same params

# LCP
/lab/ preset: big LCP image        → /test/image.png?w=0&s=500000
/lab/ preset: slow LCP image       → /test/image.png?w=2000&s=500000
<link rel="preload" as="image" href="/test/image.png?w=0&s=500000">
hidden→visible image snippet (see LCP Demo 3 above)

# CLS
<img src="/test/image.png?w=1000&s=300000">                 (no dimensions — bad)
<img src="/test/image.png?w=1000&s=300000" width="800" height="400">  (fixed)

# TBT
blockMainThread(2000)              — one long task
blockMainThreadChunked(2000, 30)   — same work, chunked

# SI
Lighthouse filmstrip: baseline vs. render-blocking stylesheet
/lab/ inject: Stylesheet w=1500 s=50000
```
