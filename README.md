# Web Performance Lab

A tiny Bun server + pages for demonstrating **FCP**, **LCP**, **TBT**, **CLS**,
and **SI** by letting you inject scripts/styles/images/fonts with a
controllable artificial delay and byte size.

## Run

```bash
bun server.js
# or, to auto-restart the server itself on changes:
bun --watch server.js
```

Then open http://localhost:3000

## Pages

- **`/`** — a simple static marketing-style homepage (nav, hero, features,
  about, footer). This is the default landing page.
- **`/lab/`** — the interactive performance lab: live metrics dashboard,
  asset-injection controls, LCP render area, and a resource timing log.

Everything under `public/` is served with `Cache-Control: no-store`, so just
edit a file and reload the browser — no build step, no restart needed for
front-end changes. Only editing `server.js` itself requires a restart (or use
`bun --watch`).

```
public/
  index.html   style.css        # "/"      simple static homepage
  lab/
    index.html style.css script.js   # "/lab/"  interactive metrics demo
```

## The `/test/` endpoint

Anything under `/test/<name>` is generated on the fly and supports two
query params:

| Param | Meaning                                  |
|-------|-------------------------------------------|
| `w`   | artificial wait before responding, in ms   |
| `s`   | approximate response size, in bytes        |

The file extension in `<name>` decides what kind of content comes back:

- `/test/script.js?w=300&s=50000` → real, executable JS padded with a comment to ~50KB, delayed 300ms
- `/test/style.css?w=100&s=10000` → real CSS, same idea
- `/test/image.png?w=500&s=200000` → a **real, valid PNG** (built by hand, no libraries) so it actually renders and can become the LCP element
- `/test/font.woff2?w=200&s=80000` → raw filler bytes with a font content-type — good for seeing the network request/timing, but note it is **not** a structurally valid font, so the browser will fall back to your next `font-family` (check devtools console). Real font shaping libraries were out of scope here.

Everything else defaults to padded plain text.

## `w` / `s` on any static file

The same `w` (delay, ms) and `s` (target size, bytes) params also work on
**any** static file served from `public/` — not just `/test/*`. This lets
you simulate a slow or heavy page load itself (e.g. slow TTFB, huge HTML
document), instead of only slow sub-resources.

- `http://localhost:3000/?w=800&s=100000` → delays the homepage response by
  800ms and pads the HTML (via an HTML comment) to ~100KB.
- `http://localhost:3000/lab/style.css?w=300&s=20000` → delays and pads the
  lab stylesheet.

Padding only applies to `.html`, `.css`, and `.js` files (padded with a
syntactically-safe comment). Other static files (images, fonts) just honor
`w` as a delay.

## Using the lab UI (`/lab/`)

- **Inject a test asset**: pick a type, wait time, and size, hit Inject.
  Scripts/styles/fonts go into `<head>`; images render in the "Render area" box.
- **Presets**: a few one-click examples (heavy blocking script, big/slow LCP image, slow CSS).
- **Metrics panel**: live FCP, LCP, approximate TBT (via Long Tasks, Chrome
  only), CLS, and TTFB, updated via `PerformanceObserver`.
- **Resource timing log**: every network request the page makes, in real time.
- **Clear injected assets**: removes everything you added and reloads.

For the real numbers (not just the approximations shown here), pair this
with Chrome DevTools → Performance panel or Lighthouse.
