/* Liber.PdfReader — continuous-scroll wrapper around pdf.js.
 * pdfjs-dist ships as an ES module, so it's loaded via a dynamic import in
 * index.html which resolves window.LiberPdfjsReady; we await that before
 * touching pdfjsLib anywhere in here. */
(function () {
  let pdfDoc = null;
  let currentBookId = null;
  let container = null;
  let contentWrap = null; // holds all .pdf-page wrappers; transformed live during pinch
  let pageWrappers = []; // { pageNum, el, rendered }
  let observer = null;
  let scale = 1;
  let baseScale = 1; // fit-width scale at open(), used to clamp pinch zoom
  let saveTimer = null;
  let restoring = false;
  let zooming = false; // true while a pinch commit's re-render pass is in flight

  // Pinch-zoom state
  let pinchStartDist = null;
  let pinchStartScale = 1;
  let liveZoom = 1;
  let justPinched = false;

  function ensurePdfjs() {
    return window.LiberPdfjsReady || Promise.resolve();
  }

  // getBoundingClientRect-based position, independent of the offsetParent
  // chain (offsetTop would be relative to whichever positioned ancestor is
  // nearest — here that's #view-reader, not the scroll container itself —
  // which threw scroll-restore off by the header's height).
  function topWithin(el) {
    return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  }

  function pinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  // Real per-page heights at the given scale, fetched upfront for every page
  // (cheap: getPage() is metadata-only against an in-memory Blob, no network).
  // Using these as placeholder heights — instead of one uniform estimate
  // borrowed from page 1 — is what stops the page-to-page height mismatch
  // that was causing the reader to visibly jump forward/back as later pages
  // (e.g. a differently-shaped map plate) swapped in their real size.
  async function computePageHeights(atScale) {
    const pages = await Promise.all(
      Array.from({ length: pdfDoc.numPages }, (_, i) => pdfDoc.getPage(i + 1))
    );
    return pages.map((page) => page.getViewport({ scale: atScale }).height);
  }

  async function open(bookRecord) {
    currentBookId = bookRecord.id;
    document.getElementById("epub-viewer").hidden = true;
    container = document.getElementById("pdf-viewer");
    container.hidden = false;
    container.innerHTML = "";
    pageWrappers = [];
    liveZoom = 1;
    pinchStartDist = null;

    await ensurePdfjs();
    if (!window.pdfjsLib) {
      container.innerHTML = '<p style="color:#a8a8a8;padding:24px;">Couldn\'t load the PDF engine. Try reopening the book.</p>';
      return false;
    }

    const data = await bookRecord.data.arrayBuffer();
    pdfDoc = await pdfjsLib.getDocument({ data }).promise;

    const firstPage = await pdfDoc.getPage(1);
    const baseViewport = firstPage.getViewport({ scale: 1 });
    const targetWidth = container.clientWidth || 360;
    scale = targetWidth / baseViewport.width;
    baseScale = scale;

    const heights = await computePageHeights(scale);

    contentWrap = document.createElement("div");
    contentWrap.className = "pdf-content";

    // Placeholder for every page up front, sized to its real dimensions, so
    // the scroll height (and the scrollbar) is correct immediately and
    // never has to shift once actual canvases render in. Pages render
    // lazily as they near the viewport, via IntersectionObserver, below.
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const wrapper = document.createElement("div");
      wrapper.className = "pdf-page";
      wrapper.dataset.page = String(n);
      wrapper.style.height = heights[n - 1] + "px";
      frag.appendChild(wrapper);
      pageWrappers.push({ pageNum: n, el: wrapper, rendered: false });
    }
    contentWrap.appendChild(frag);
    container.appendChild(contentWrap);

    setupObserver();
    pageWrappers.forEach((w) => observer.observe(w.el));
    container.addEventListener("scroll", onScroll);
    container.addEventListener("click", onTap);
    container.addEventListener("touchstart", onTouchStart, { passive: false });
    container.addEventListener("touchmove", onTouchMove, { passive: false });
    container.addEventListener("touchend", onTouchEnd);

    const savedPage = (bookRecord.progress && bookRecord.progress.page) || 1;
    if (savedPage > 1) {
      restoring = true;
      requestAnimationFrame(() => {
        const target = pageWrappers[savedPage - 1];
        if (target) container.scrollTop = topWithin(target.el);
        restoring = false;
      });
    }

    buildToc();
    return true;
  }

  function onTap() {
    if (justPinched) return;
    document.dispatchEvent(new CustomEvent("liber:tap"));
  }

  // --- Pinch to zoom -------------------------------------------------
  // Live feedback is a cheap CSS transform on the content wrapper (no
  // re-render on every frame). On release, the transform is committed as a
  // real pdf.js render scale and pages are re-rendered at the new
  // resolution.
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      e.preventDefault();
      pinchStartDist = pinchDistance(e.touches);
      pinchStartScale = scale;
      const rect = contentWrap.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      contentWrap.style.transformOrigin = midX + "px " + midY + "px";
    }
  }

  function onTouchMove(e) {
    if (e.touches.length === 2 && pinchStartDist) {
      e.preventDefault();
      liveZoom = pinchDistance(e.touches) / pinchStartDist;
      contentWrap.style.transform = "scale(" + liveZoom + ")";
    }
  }

  async function onTouchEnd(e) {
    if (e.touches.length >= 2 || !pinchStartDist) return;
    pinchStartDist = null;
    contentWrap.style.transform = "none";

    const minScale = baseScale * 0.5;
    const maxScale = baseScale * 3.5;
    const newScale = Math.max(minScale, Math.min(maxScale, pinchStartScale * liveZoom));
    liveZoom = 1;

    if (Math.abs(newScale / scale - 1) < 0.01) return; // effectively just a tap-through, no real pinch

    justPinched = true;
    setTimeout(() => (justPinched = false), 300);

    const keepPage = currentVisiblePage() || 1;
    scale = newScale;
    zooming = true;

    try {
      const heights = await computePageHeights(scale);
      pageWrappers.forEach((w, i) => {
        w.rendered = false;
        w.el.innerHTML = "";
        w.el.style.height = heights[i] + "px";
        // IntersectionObserver only reports *changes* in intersection — a
        // page that was already on screen stays "already intersecting" and
        // would otherwise never get a fresh callback, so it'd stay blank
        // forever after a zoom. Re-observing forces a fresh check for
        // every page, including the ones already visible.
        observer.unobserve(w.el);
        observer.observe(w.el);
      });

      const target = pageWrappers[keepPage - 1];
      if (target) container.scrollTop = topWithin(target.el);
    } finally {
      zooming = false;
    }
  }

  function setupObserver() {
    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const w = pageWrappers.find((p) => p.el === entry.target);
          if (w && !w.rendered) renderPage(w);
        });
      },
      { root: container, rootMargin: "1000px 0px 1000px 0px" }
    );
  }

  async function renderPage(wrapper) {
  wrapper.rendered = true;

  // Preserve the user's viewport while the page's canvas is inserted.
  // Android WebView can change scrollTop when DOM children are replaced
  // inside an actively scrolling container.
  const rootRectBefore = container.getBoundingClientRect();

  let anchor = null;
  let anchorTopBefore = null;

  // Pick the page currently underneath the user's reading position.
  const probe = container.scrollTop + container.clientHeight * 0.35;

  for (const candidate of pageWrappers) {
    const top = topWithin(candidate.el);
    const bottom = top + candidate.el.offsetHeight;

    if (top <= probe && bottom > probe) {
      anchor = candidate;
      anchorTopBefore =
        anchor.el.getBoundingClientRect().top - rootRectBefore.top;
      break;
    }
  }

  const page = await pdfDoc.getPage(wrapper.pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // Keep the placeholder exactly the same size as the real rendered page.
  const h = viewport.height + "px";

  if (wrapper.el.style.height !== h) {
    wrapper.el.style.height = h;
  }

  // Replace only this page's contents.
  wrapper.el.replaceChildren(canvas);

  // Wait for the browser to finish the layout change, then compensate for
  // any scroll movement caused by that DOM change.
  requestAnimationFrame(() => {
    if (!container || !anchor || !anchor.el.isConnected) return;

    const rootRectAfter = container.getBoundingClientRect();

    const anchorTopAfter =
      anchor.el.getBoundingClientRect().top - rootRectAfter.top;

    const layoutDelta = anchorTopAfter - anchorTopBefore;

    if (Math.abs(layoutDelta) > 0.5) {
      container.scrollTop += layoutDelta;
    }
  });

  const ctx = canvas.getContext("2d");

  try {
    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;
  } catch (e) {
    // Page may have been cancelled by a fast scroll/zoom; harmless.
  }
  }

  function currentVisiblePage() {
    if (!container || !pageWrappers.length) return null;
    const probe = container.scrollTop + container.clientHeight * 0.3;
    for (const w of pageWrappers) {
      const top = topWithin(w.el);
      if (top <= probe && top + w.el.offsetHeight > probe) {
        return w.pageNum;
      }
    }
    return pageWrappers[pageWrappers.length - 1].pageNum;
  }

  function onScroll() {
    if (restoring || zooming) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const current = currentVisiblePage();
      if (!current || !pdfDoc) return;
      const percent = Math.round((current / pdfDoc.numPages) * 100);
      document.getElementById("reader-progress").textContent =
        current + " / " + pdfDoc.numPages;
      LiberDB.updateBook(currentBookId, {
        progress: { page: current, percent },
        lastOpenedAt: Date.now(),
      });
    }, 250);
  }

  async function buildToc() {
    const list = document.getElementById("toc-list");
    list.innerHTML = "";
    try {
      const outline = await pdfDoc.getOutline();
      (outline || []).forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item.title;
        li.addEventListener("click", async () => {
          if (Array.isArray(item.dest)) {
            const idx = await pdfDoc.getPageIndex(item.dest[0]);
            scrollToPage(idx + 1);
          }
          document.getElementById("toc-panel").hidden = true;
        });
        list.appendChild(li);
      });
    } catch (e) {
      /* some PDFs have no outline */
    }
  }

  function scrollToPage(num, smooth) {
    const target = pageWrappers[num - 1];
    if (!target || !container) return;
    container.scrollTo({
      top: topWithin(target.el),
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function next() {
    const current = currentVisiblePage() || 1;
    if (pdfDoc && current < pdfDoc.numPages) scrollToPage(current + 1, true);
  }
  function prev() {
    const current = currentVisiblePage() || 1;
    if (current > 1) scrollToPage(current - 1, true);
  }

  function destroy() {
    if (observer) observer.disconnect();
    if (container) {
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("click", onTap);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("touchend", onTouchEnd);
    }
    observer = null;
    pdfDoc = null;
    pageWrappers = [];
    container = null;
    contentWrap = null;
    currentBookId = null;
    pinchStartDist = null;
    zooming = false;
  }

  window.LiberPdfReader = { open, next, prev, destroy };
})();
