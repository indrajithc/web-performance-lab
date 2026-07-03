// server.js
// Bun server for the "Web Performance Lab" demo.
//
// Run with:  bun server.js
// Then open: http://localhost:3000
//
// Two jobs:
//  1) Serve /public as a plain static site, always fresh (no caching),
//     so editing index.html/style.css/script.js and reloading the browser
//     just works.
//  2) Serve dynamically generated assets under /test/* — any request like
//       /test/script.js?w=300&s=50000
//     will be delayed by `w` milliseconds and padded to roughly `s` bytes,
//     so you can simulate slow/huge scripts, styles, fonts and images and
//     watch how they affect FCP / LCP / TBT / CLS in devtools.

import { file } from "bun";
import path from "node:path";
import zlib from "node:zlib";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(import.meta.dir, "public");

// ---------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------

function clamp(n, min, max) {
  if (Number.isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME[ext] || "application/octet-stream";
}

// Pad a text asset (JS/CSS/plain text) out to `targetSize` bytes by
// appending a block comment full of filler characters. If targetSize is
// smaller than the base content, the base content is returned unchanged
// (we never truncate real code).
function padTextAsset(base, targetSize, commentOpen = "/*", commentClose = "*/") {
  const baseSize = Buffer.byteLength(base, "utf8");
  if (!targetSize || targetSize <= baseSize) return base;
  const overhead = commentOpen.length + commentClose.length + 2; // + newline + safety
  const padLen = targetSize - baseSize - overhead;
  if (padLen <= 0) return base;
  const filler = "x".repeat(padLen);
  return `${base}\n${commentOpen}${filler}${commentClose}`;
}

function fillerBytes(n) {
  return Buffer.alloc(Math.max(n, 0), 0x78); // fill with 'x'
}

// ---------------------------------------------------------------------
// minimal PNG encoder, so /test/image.png?s=NNNN produces a REAL,
// renderable PNG of (approximately) the requested byte size. This matters
// because a broken image never becomes an LCP candidate.
// ---------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Deterministic-ish color from a seed string so repeated requests with the
// same params look the same, but different sizes/paths look different.
function colorFromSeed(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return [64 + (h & 0x7f), 64 + ((h >> 8) & 0x7f), 64 + ((h >> 16) & 0x7f)];
}

function buildPNG({ width = 24, height = 24, seed = "img", targetSize = 0 }) {
  const [r, g, b] = colorFromSeed(seed);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = pngChunk("IHDR", ihdrData);

  const rowSize = width * 3 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      const idx = rowStart + 1 + x * 3;
      raw[idx] = r;
      raw[idx + 1] = g;
      raw[idx + 2] = b;
    }
  }
  const idat = pngChunk("IDAT", zlib.deflateSync(raw));
  const iend = pngChunk("IEND", Buffer.alloc(0));

  let chunks = [sig, ihdr, idat, iend];
  let total = chunks.reduce((a, c) => a + c.length, 0);

  if (targetSize && targetSize > total) {
    // Pad using a standard, ignorable tEXt chunk (keyword + null + text).
    const keyword = "Padding";
    const overhead = keyword.length + 1 + 12; // keyword + separator + chunk overhead
    const padLen = targetSize - total - overhead;
    if (padLen > 0) {
      const textData = Buffer.concat([
        Buffer.from(keyword + "\0", "ascii"),
        Buffer.alloc(padLen, 0x78),
      ]);
      const padChunk = pngChunk("tEXt", textData);
      chunks = [sig, ihdr, idat, padChunk, iend];
    }
  }

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------
// base contents for generated JS / CSS
// ---------------------------------------------------------------------

const BASE_JS = `(function () {
  var s = document.currentScript;
  var url = s ? s.src : "";
  var params = url ? new URL(url).searchParams : new URLSearchParams();
  window.dispatchEvent(new CustomEvent("test-asset-loaded", {
    detail: {
      type: "script",
      url: url,
      wait: params.get("w"),
      size: params.get("s"),
      time: performance.now()
    }
  }));
  console.log("[test-script] executed", { wait: params.get("w"), size: params.get("s") });
})();`;

// `c` (complexity) controls how long this script busy-loops the main
// thread once it executes in the browser — separate from `w`, which only
// delays the network response. Each unit of `c` blocks for BLOCK_MS_PER_C
// milliseconds, so e.g. c=10 -> ~1000ms long task -> big TBT hit.
const BLOCK_MS_PER_C = 100;

function buildBlockingJS(c) {
  const blockMs = c * BLOCK_MS_PER_C;
  return `(function () {
  var s = document.currentScript;
  var url = s ? s.src : "";
  var params = url ? new URL(url).searchParams : new URLSearchParams();
  var blockMs = ${blockMs};
  var end = performance.now() + blockMs;
  while (performance.now() < end) { /* busy loop: simulate c=${c} complexity */ }
  window.dispatchEvent(new CustomEvent("test-asset-loaded", {
    detail: {
      type: "script",
      url: url,
      wait: params.get("w"),
      size: params.get("s"),
      complexity: params.get("c"),
      blockedMs: blockMs,
      time: performance.now()
    }
  }));
  console.log("[test-script] executed", { wait: params.get("w"), size: params.get("s"), complexity: params.get("c"), blockedMs: blockMs });
})();`;
}

const BASE_CSS = `/* generated test stylesheet */
body { --test-css-loaded: 1; }
.test-css-marker::after { content: "css loaded"; }`;

function mimeFontFor(ext) {
  switch (ext) {
    case ".woff2": return "font/woff2";
    case ".woff": return "font/woff";
    case ".ttf": return "font/ttf";
    case ".otf": return "font/otf";
    default: return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------
// /test/* handler
// ---------------------------------------------------------------------

const MAX_WAIT_MS = 60_000;
const MAX_SIZE_BYTES = 20 * 1024 * 1024; // 20MB safety cap
const MAX_COMPLEXITY = 100; // clamps blocking time to 100 * BLOCK_MS_PER_C = 10s

async function handleTestAsset(pathname, searchParams) {
  const w = clamp(parseInt(searchParams.get("w") || "0", 10), 0, MAX_WAIT_MS);
  const s = clamp(parseInt(searchParams.get("s") || "0", 10), 0, MAX_SIZE_BYTES);
  const c = clamp(parseInt(searchParams.get("c") || "0", 10), 0, MAX_COMPLEXITY);
  const ext = path.extname(pathname).toLowerCase();

  if (w > 0) await Bun.sleep(w);

  let body;
  let contentType;

  switch (ext) {
    case ".js":
      contentType = "text/javascript; charset=utf-8";
      body = padTextAsset(c > 0 ? buildBlockingJS(c) : BASE_JS, s);
      break;

    case ".css":
      contentType = "text/css; charset=utf-8";
      body = padTextAsset(BASE_CSS, s);
      break;

    case ".png":
      contentType = "image/png";
      body = buildPNG({ width: 32, height: 32, seed: pathname + searchParams.toString(), targetSize: s });
      break;

    case ".woff":
    case ".woff2":
    case ".ttf":
    case ".otf":
      // NOTE: this is NOT a valid font file — just raw filler bytes with a
      // font content-type. It's enough to demonstrate request timing /
      // render-blocking behavior in the Network tab, but the browser will
      // reject it as a glyph source and fall back to the next font in your
      // font-family stack (check devtools console for the parse warning).
      contentType = mimeFontFor(ext);
      body = fillerBytes(Math.max(s, 16));
      break;

    default:
      contentType = "text/plain; charset=utf-8";
      body = padTextAsset("/* generated test asset */", s);
  }

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store, must-revalidate, max-age=0",
      "Access-Control-Allow-Origin": "*",
      "Timing-Allow-Origin": "*",
    },
  });
}

// ---------------------------------------------------------------------
// static file handler (for anything NOT under /test/)
// ---------------------------------------------------------------------

// Comment delimiters used to pad each text-based file type without
// breaking its syntax.
const PAD_DELIMS = {
  ".html": ["<!--", "-->"],
  ".css": ["/*", "*/"],
  ".js": ["/*", "*/"],
};

async function handleStatic(pathname, searchParams) {
  if (pathname.endsWith("/")) pathname += "index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  const f = file(filePath);
  if (!(await f.exists())) {
    return new Response("Not found", { status: 404 });
  }

  // Any static file can be requested with ?w=<ms>&s=<bytes> to simulate a
  // slow / heavy response, same as /test/* assets.
  const w = clamp(parseInt(searchParams.get("w") || "0", 10), 0, MAX_WAIT_MS);
  const s = clamp(parseInt(searchParams.get("s") || "0", 10), 0, MAX_SIZE_BYTES);

  if (w > 0) await Bun.sleep(w);

  const contentType = mimeFor(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const delims = PAD_DELIMS[ext];

  if (s > 0 && delims) {
    const body = padTextAsset(await f.text(), s, delims[0], delims[1]);
    return new Response(body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store, must-revalidate, max-age=0",
      },
    });
  }

  return new Response(f, {
    headers: {
      "Content-Type": contentType,
      // No caching, so edit -> reload always shows the latest file.
      "Cache-Control": "no-store, must-revalidate, max-age=0",
    },
  });
}

// ---------------------------------------------------------------------
// server
// ---------------------------------------------------------------------

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/test/")) {
      return handleTestAsset(pathname, url.searchParams);
    }
    return handleStatic(pathname, url.searchParams);
  },
});

console.log(`\n  Web Performance Lab running at http://localhost:${PORT}\n`);
console.log(`  Try:  http://localhost:${PORT}/test/script.js?w=300&s=50000`);
console.log(`        http://localhost:${PORT}/test/image.png?w=500&s=200000`);
console.log(`        http://localhost:${PORT}/test/style.css?w=100&s=10000\n`);
