/* Liber.EpubReader — thin wrapper around epub.js.
 * epub.js renders each chapter into its own iframe, so touch/click events
 * inside the book text never reach the outer page's listeners on their own.
 * rendition.hooks.content.register(...) is epub.js's official way to attach
 * real listeners directly onto each iframe's document as it's rendered —
 * that's how tap-to-hide-chrome and pinch-to-zoom are wired up below. */
(function () {
  let book = null;
  let rendition = null;
  let currentBookId = null;
  let currentTheme = "dark";
  let fontPct = 100;
  let pinchStartDist = null;
  let pinchStartPct = 100;
  let fontRaf = null;

  const MIN_FONT_PCT = 65;
  const MAX_FONT_PCT = 260;

  function themeRules(theme) {
    return theme === "light"
      ? {
          body: { background: "#ffffff !important", color: "#000000 !important" },
          "a, a:link": { color: "#000000 !important" },
        }
      : {
          body: { background: "#000000 !important", color: "#ffffff !important" },
          "a, a:link": { color: "#ffffff !important" },
        };
  }

  function setTheme(theme) {
    currentTheme = theme === "light" ? "light" : "dark";
    if (rendition) rendition.themes.default(themeRules(currentTheme));
  }

  function setFontPct(pct) {
    fontPct = Math.max(MIN_FONT_PCT, Math.min(MAX_FONT_PCT, pct));
    if (!rendition) return;
    // Reflowing text on every touchmove frame is wasteful; one pending
    // update via rAF keeps the pinch feeling live without piling up work.
    if (fontRaf) return;
    fontRaf = requestAnimationFrame(() => {
      fontRaf = null;
      rendition.themes.fontSize(fontPct + "%");
    });
  }

  function pinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function attachContentGestures(contents) {
    const doc = contents && contents.document;
    if (!doc) return;

    doc.addEventListener("click", () => {
      document.dispatchEvent(new CustomEvent("liber:tap"));
    });

    doc.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          pinchStartDist = pinchDistance(e.touches);
          pinchStartPct = fontPct;
        }
      },
      { passive: false }
    );

    doc.addEventListener(
      "touchmove",
      (e) => {
        if (e.touches.length === 2 && pinchStartDist) {
          e.preventDefault();
          const ratio = pinchDistance(e.touches) / pinchStartDist;
          setFontPct(pinchStartPct * ratio);
        }
      },
      { passive: false }
    );

    doc.addEventListener("touchend", (e) => {
      if (e.touches.length < 2) pinchStartDist = null;
    });
  }

  async function open(bookRecord) {
    currentBookId = bookRecord.id;
    const container = document.getElementById("epub-viewer");
    container.innerHTML = "";
    document.getElementById("pdf-viewer").hidden = true;
    container.hidden = false;

    fontPct = 100;
    pinchStartDist = null;

    book = ePub(bookRecord.data);
    rendition = book.renderTo(container, {
      width: "100%",
      height: "100%",
      flow: "scrolled",
      manager: "continuous",
    });

    rendition.themes.default(themeRules(currentTheme));
    rendition.themes.fontSize(fontPct + "%");
    rendition.hooks.content.register(attachContentGestures);

    const startCfi = bookRecord.progress && bookRecord.progress.cfi;
    await rendition.display(startCfi || undefined);

    rendition.on("relocated", (location) => {
      const cfi = location.start.cfi;
      let percent = 0;
      try {
        percent = book.locations.length()
          ? Math.round(book.locations.percentageFromCfi(cfi) * 100)
          : 0;
      } catch (e) {}
      LiberDB.updateBook(currentBookId, {
        progress: { cfi, percent },
        lastOpenedAt: Date.now(),
      });
      document.getElementById("reader-progress").textContent = percent
        ? percent + "%"
        : "";
    });

    // Build locations in the background for percentage tracking (best-effort).
    book.locations.generate(1000).catch(() => {});

    await buildToc();
    return true;
  }

  async function buildToc() {
    const list = document.getElementById("toc-list");
    list.innerHTML = "";
    const nav = await book.loaded.navigation;
    (nav.toc || []).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item.label.trim();
      li.addEventListener("click", () => {
        rendition.display(item.href);
        document.getElementById("toc-panel").hidden = true;
      });
      list.appendChild(li);
    });
  }

  function next() {
    if (rendition) rendition.next();
  }
  function prev() {
    if (rendition) rendition.prev();
  }

  function destroy() {
    if (rendition) {
      rendition.destroy();
      rendition = null;
    }
    book = null;
    currentBookId = null;
    pinchStartDist = null;
  }

  window.LiberEpubReader = { open, next, prev, destroy, setTheme };
})();
