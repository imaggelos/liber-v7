/* Liber — main app controller */
(function () {
  const shelf = document.getElementById("shelf");
  const emptyState = document.getElementById("empty-state");
  const fileInput = document.getElementById("file-input");
  const viewLibrary = document.getElementById("view-library");
  const viewReader = document.getElementById("view-reader");
  const readerTitle = document.getElementById("reader-title");
  const tocPanel = document.getElementById("toc-panel");
  const toast = document.getElementById("toast");

  let activeBook = null; // { id, format }
  let readerTheme = localStorage.getItem("liber-reader-theme") || "dark";

  function applyReaderTheme(theme) {
    readerTheme = theme === "light" ? "light" : "dark";
    viewReader.classList.toggle("theme-light", readerTheme === "light");
    if (activeBook && activeBook.format === "epub") {
      LiberEpubReader.setTheme(readerTheme);
    }
    localStorage.setItem("liber-reader-theme", readerTheme);
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(showToast._t);
    const duration = Math.min(6000, Math.max(2200, msg.length * 60));
    showToast._t = setTimeout(() => (toast.hidden = true), duration);
  }

  function formatOf(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".epub")) return "epub";
    if (name.endsWith(".pdf")) return "pdf";
    if (file.type === "application/epub+zip") return "epub";
    if (file.type === "application/pdf") return "pdf";
    return null;
  }

  // Extracts a cover thumbnail so the shelf can show the book's real cover
  // instead of a placeholder initial. Best-effort: returns null on failure
  // and the shelf just falls back to the initial-letter tile.
  async function generateCover(file, format) {
    try {
      if (format === "epub") {
        const tempBook = ePub(file);
        await tempBook.opened;
        const url = await tempBook.coverUrl();
        let blob = null;
        if (url) {
          const resp = await fetch(url);
          blob = await resp.blob();
        }
        if (tempBook.destroy) tempBook.destroy();
        return blob;
      }

      if (format === "pdf") {
        await (window.LiberPdfjsReady || Promise.resolve());
        if (!window.pdfjsLib) return null;
        const buf = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 0.6 });
        const off = document.createElement("canvas");
        off.width = viewport.width;
        off.height = viewport.height;
        const ctx = off.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        return await new Promise((resolve) =>
          off.toBlob((b) => resolve(b), "image/png", 0.85)
        );
      }
    } catch (e) {
      console.warn("Liber: cover generation failed", e);
    }
    return null;
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList);
    for (const file of files) {
      const format = formatOf(file);
      if (!format) {
        showToast(file.name + " isn't an EPUB or PDF");
        continue;
      }
      const id = "b_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      const cover = await generateCover(file, format);
      const record = {
        id,
        title: file.name.replace(/\.(epub|pdf)$/i, ""),
        author: "",
        format,
        data: file, // Blob, stored directly in IndexedDB
        cover, // Blob or null
        addedAt: Date.now(),
        lastOpenedAt: null,
        progress: {},
      };
      try {
        await LiberDB.addBook(record);
      } catch (e) {
        console.error("Liber: failed to save book", file.name, e);
        let failed = true;
        // The cover thumbnail isn't essential — if it's what's pushing a
        // constrained storage quota over the edge, retry without it rather
        // than losing the whole import.
        if (record.cover) {
          try {
            record.cover = null;
            await LiberDB.addBook(record);
            failed = false;
          } catch (e2) {
            e = e2;
          }
        }
        if (failed) {
          const detail = (e && (e.name || e.message)) || String(e);
          showToast("Couldn't save " + file.name + " — " + detail);
        }
      }
    }
    await renderLibrary();
  }

  function progressPercent(book) {
    return (book.progress && book.progress.percent) || 0;
  }

  let coverObjectUrls = [];

  async function renderLibrary() {
    const books = await LiberDB.getAllBooks();
    books.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt));

    // Revoke object URLs from the previous render before creating new ones.
    coverObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    coverObjectUrls = [];

    shelf.innerHTML = "";
    emptyState.style.display = books.length ? "none" : "flex";

    books.forEach((book) => {
      const card = document.createElement("div");
      card.className = "book-card";

      const cover = document.createElement("div");
      cover.className = "book-cover";
      if (book.cover) {
        const img = document.createElement("img");
        const objectUrl = URL.createObjectURL(book.cover);
        coverObjectUrls.push(objectUrl);
        img.src = objectUrl;
        img.alt = book.title;
        cover.appendChild(img);
      } else {
        const initial = document.createElement("span");
        initial.className = "initial";
        initial.textContent = (book.title || "?").trim().charAt(0).toUpperCase();
        cover.appendChild(initial);
      }

      const badge = document.createElement("span");
      badge.className = "fmt-badge";
      badge.textContent = book.format.toUpperCase();
      cover.appendChild(badge);

      const title = document.createElement("div");
      title.className = "book-title";
      title.textContent = book.title;

      const progress = document.createElement("div");
      progress.className = "book-progress";
      const bar = document.createElement("i");
      bar.style.width = progressPercent(book) + "%";
      progress.appendChild(bar);

      card.appendChild(cover);
      card.appendChild(title);
      card.appendChild(progress);

      card.addEventListener("click", () => openBook(book));
      card.addEventListener(
        "contextmenu",
        (e) => {
          e.preventDefault();
          confirmDelete(book);
        },
        { passive: false }
      );

      let pressTimer;
      card.addEventListener("touchstart", () => {
        pressTimer = setTimeout(() => confirmDelete(book), 600);
      });
      card.addEventListener("touchend", () => clearTimeout(pressTimer));
      card.addEventListener("touchmove", () => clearTimeout(pressTimer));

      shelf.appendChild(card);
    });
  }

  async function confirmDelete(book) {
    if (confirm('Remove "' + book.title + '" from your library?')) {
      await LiberDB.deleteBook(book.id);
      await renderLibrary();
    }
  }

  async function openBook(book) {
    activeBook = book;
    readerTitle.textContent = book.title;
    viewReader.classList.remove("chrome-hidden");
    viewLibrary.classList.remove("active");
    viewReader.classList.add("active");

    if (book.format === "epub") {
      await LiberEpubReader.open(book);
    } else {
      await LiberPdfReader.open(book);
    }
    applyReaderTheme(readerTheme);
  }

  function closeReader() {
    if (activeBook && activeBook.format === "epub") LiberEpubReader.destroy();
    if (activeBook && activeBook.format === "pdf") LiberPdfReader.destroy();
    activeBook = null;
    viewReader.classList.remove("active", "chrome-hidden");
    viewLibrary.classList.add("active");
    tocPanel.hidden = true;
    renderLibrary();
  }

  // Wire up UI
  document.getElementById("btn-add").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) importFiles(e.target.files);
    fileInput.value = "";
  });
  document.getElementById("btn-back").addEventListener("click", closeReader);
  document.getElementById("btn-toc").addEventListener("click", () => {
    tocPanel.hidden = !tocPanel.hidden;
  });
  document.getElementById("btn-toc-close").addEventListener("click", () => {
    tocPanel.hidden = true;
  });
  document.getElementById("btn-theme").addEventListener("click", () => {
    applyReaderTheme(readerTheme === "dark" ? "light" : "dark");
  });

  // Tap anywhere in the book text to hide/show the reader chrome (top bar,
  // bottom nav) for an immersive full-bleed reading view. Both readers
  // dispatch this same event on a genuine tap (see reader-epub.js's content
  // hooks and reader-pdf.js's click listener).
  function toggleChrome() {
    if (!tocPanel.hidden) {
      tocPanel.hidden = true;
      return;
    }
    viewReader.classList.toggle("chrome-hidden");
  }
  document.addEventListener("liber:tap", toggleChrome);

  // Android hardware back button: return to the library instead of exiting
  // the app. Only present inside the actual Capacitor Android app — no-ops
  // harmlessly when testing in a regular browser.
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener("backButton", () => {
      if (viewReader.classList.contains("active")) {
        if (!tocPanel.hidden) {
          tocPanel.hidden = true;
          return;
        }
        closeReader();
        return;
      }
      window.Capacitor.Plugins.App.exitApp();
    });
  }

  // Ask for persistent storage so the WebView is less likely to apply a
  // tight/ephemeral quota to IndexedDB. Best-effort — safe to ignore if
  // unsupported or declined.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  // Register service worker for offline-first behavior
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  renderLibrary();
})();
