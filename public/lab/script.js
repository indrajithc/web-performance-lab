// public/script.js — metrics dashboard + dynamic /test/ asset injection

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------
  // 1) METRICS
  // ---------------------------------------------------------------

  const state = {
    fcp: null,
    lcp: null,
    cls: 0,
    tbt: 0,
    lcpElement: null,
  };

  function setMetric(id, text, level) {
    const el = $(id);
    el.textContent = text;
    const card = el.closest(".metric-card");
    card.classList.remove("good", "warn", "bad");
    if (level) card.classList.add(level);
  }

  function fmtMs(ms) {
    return `${Math.round(ms)} ms`;
  }

  // TTFB from Navigation Timing
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav) {
      const ttfb = nav.responseStart - nav.requestStart;
      setMetric("m-ttfb", fmtMs(ttfb), ttfb < 200 ? "good" : ttfb < 600 ? "warn" : "bad");
    }
  } catch (e) {}

  // FCP
  try {
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === "first-contentful-paint") {
          state.fcp = entry.startTime;
          setMetric("m-fcp", fmtMs(entry.startTime), entry.startTime < 1800 ? "good" : entry.startTime < 3000 ? "warn" : "bad");
        }
      }
    });
    po.observe({ type: "paint", buffered: true });
  } catch (e) {}

  // LCP (keeps updating until the browser finalizes it on input/visibility change)
  try {
    const po = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (!last) return;
      state.lcp = last.startTime;
      state.lcpElement = last.element || null;
      setMetric("m-lcp", fmtMs(last.startTime), last.startTime < 2500 ? "good" : last.startTime < 4000 ? "warn" : "bad");
      const hint = $("lcp-hint");
      const desc = last.element
        ? `${last.element.tagName.toLowerCase()}${last.element.id ? "#" + last.element.id : ""}`
        : last.url || "unknown";
      hint.textContent = `LCP element: ${desc} (${Math.round(last.size)} px²)`;
    });
    po.observe({ type: "largest-contentful-paint", buffered: true });

    const finalize = () => po.takeRecords && po.disconnect();
    ["keydown", "click", "visibilitychange"].forEach((ev) =>
      addEventListener(ev, finalize, { once: true, capture: true })
    );
  } catch (e) {}

  // CLS
  try {
    let clsValue = 0;
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
          state.cls = clsValue;
          setMetric("m-cls", clsValue.toFixed(3), clsValue < 0.1 ? "good" : clsValue < 0.25 ? "warn" : "bad");
        }
      }
    });
    po.observe({ type: "layout-shift", buffered: true });
  } catch (e) {}

  // TBT (approximation via Long Tasks — Chrome only)
  try {
    let tbt = 0;
    const po = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const blocking = entry.duration - 50;
        if (blocking > 0) {
          tbt += blocking;
          state.tbt = tbt;
          setMetric("m-tbt", fmtMs(tbt), tbt < 200 ? "good" : tbt < 600 ? "warn" : "bad");
        }
      }
    });
    po.observe({ type: "longtask", buffered: true });
  } catch (e) {
    setMetric("m-tbt", "n/a");
  }

  // ---------------------------------------------------------------
  // 2) RESOURCE TIMING LOG (live)
  // ---------------------------------------------------------------

  const tbody = $("resource-table-body");
  const seen = new Set();

  function addRow(entry) {
    if (seen.has(entry.name + entry.startTime)) return;
    seen.add(entry.name + entry.startTime);
    const tr = document.createElement("tr");
    const shortName = entry.name.replace(location.origin, "");
    tr.innerHTML = `
      <td class="name" title="${entry.name}">${shortName}</td>
      <td>${fmtMs(entry.startTime)}</td>
      <td>${fmtMs(entry.duration)}</td>
      <td>${entry.transferSize ? (entry.transferSize / 1024).toFixed(1) + " KB" : "—"}</td>
    `;
    tbody.prepend(tr);
  }

  performance.getEntriesByType("resource").forEach(addRow);
  try {
    const po = new PerformanceObserver((list) => list.getEntries().forEach(addRow));
    po.observe({ type: "resource", buffered: true });
  } catch (e) {}

  // ---------------------------------------------------------------
  // 3) DYNAMIC ASSET INJECTION under /test/*
  // ---------------------------------------------------------------

  const injected = []; // track injected elements so "Clear" can remove them

  function testUrl(name, w, s) {
    const params = new URLSearchParams({ w: String(w || 0), s: String(s || 0), t: String(Date.now()) });
    return `/test/${name}?${params.toString()}`;
  }

  function injectScript(w, s, async) {
    const el = document.createElement("script");
    el.src = testUrl("script.js", w, s);
    if (async) el.async = true;
    el.dataset.injected = "true";
    document.head.appendChild(el);
    injected.push(el);
  }

  function injectStyle(w, s) {
    const el = document.createElement("link");
    el.rel = "stylesheet";
    el.href = testUrl("style.css", w, s);
    el.dataset.injected = "true";
    document.head.appendChild(el);
    injected.push(el);
  }

  function injectImage(w, s) {
    const img = document.createElement("img");
    img.src = testUrl("image.png", w, s);
    img.alt = `test image w=${w} s=${s}`;
    img.dataset.injected = "true";
    $("image-slot").appendChild(img);
    injected.push(img);
  }

  function injectFont(w, s) {
    const styleTag = document.createElement("style");
    const family = `test-font-${Date.now()}`;
    styleTag.dataset.injected = "true";
    styleTag.textContent = `
      @font-face {
        font-family: "${family}";
        src: url("${testUrl("font.woff2", w, s)}") format("woff2");
        font-display: block;
      }
      #render-target h3 { font-family: "${family}", sans-serif; }
    `;
    document.head.appendChild(styleTag);
    injected.push(styleTag);
  }

  function inject(type, w, s) {
    switch (type) {
      case "script": return injectScript(w, s, false);
      case "script-async": return injectScript(w, s, true);
      case "style": return injectStyle(w, s);
      case "image": return injectImage(w, s);
      case "font": return injectFont(w, s);
    }
  }

  $("inject-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const type = $("asset-type").value;
    const w = parseInt($("asset-wait").value, 10) || 0;
    const s = parseInt($("asset-size").value, 10) || 0;
    inject(type, w, s);
  });

  document.querySelectorAll(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      inject(btn.dataset.type, Number(btn.dataset.w), Number(btn.dataset.s));
    });
  });

  $("clear-btn").addEventListener("click", () => {
    injected.forEach((el) => el.remove());
    injected.length = 0;
    $("image-slot").innerHTML = "";
    location.reload();
  });

  window.addEventListener("test-asset-loaded", (e) => {
    console.log("test asset loaded:", e.detail);
  });
})();
