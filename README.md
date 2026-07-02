# Web Performance Lab

A tiny Bun server + page for demonstrating **FCP**, **LCP**, **TBT**, and **CLS**
by letting you inject scripts/styles/images/fonts with a controllable
artificial delay and byte size.

## Run

```bash
bun server.js
# or, to auto-restart the server itself on changes:
bun --watch server.js
```

Then open http://localhost:3000

The `public/` folder (`index.html`, `style.css`, `script.js`) is served with
`Cache-Control: no-store`, so just edit a file and reload the browser — no
build step, no restart needed for front-end changes. Only editing
`server.js` itself requires a restart (or use `bun --watch`).

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

This logic only applies to paths starting with `/test/` — nothing else on
the site is affected.

## Using the UI

- **Inject a test asset**: pick a type, wait time, and size, hit Inject.
  Scripts/styles/fonts go into `<head>`; images render in the "Render area" box.
- **Presets**: a few one-click examples (heavy blocking script, big/slow LCP image, slow CSS).
- **Metrics panel**: live FCP, LCP, approximate TBT (via Long Tasks, Chrome
  only), CLS, and TTFB, updated via `PerformanceObserver`.
- **Resource timing log**: every network request the page makes, in real time.
- **Clear injected assets**: removes everything you added and reloads.

For the real numbers (not just the approximations shown here), pair this
with Chrome DevTools → Performance panel or Lighthouse.
