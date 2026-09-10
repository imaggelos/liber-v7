/* Liber — main app controller */
(function () {
  const fileInput = document.getElementById("file-input");
  const viewLibrary = document.getElementById("view-library");
  const viewReader = document.getElementById("view-reader");
  const readerTitle = document.getElementById("reader-title");
  const tocPanel = document.getElementById("toc-panel");
  const toast = document.getElementById("toast");

  const homeContent = document.getElementById("home-content");
  const allLibrary = document.getElementById("all-library");

  const continueShelf =
    document.getElementById("continue-shelf");

  const tbrShelf =
    document.getElementById("tbr-shelf");

  const libraryBookshelf =
    document.getElementById("library-bookshelf");

  const continueEmpty =
    document.getElementById("continue-empty");

  const tbrEmpty =
    document.getElementById("tbr-empty");

  const libraryEmpty =
    document.getElementById("library-empty");

  const navHome =
    document.getElementById("nav-home");

  const navLibrary =
    document.getElementById("nav-library");

  const settingsModal =
    document.getElementById("book-settings");

  const settingsCover =
    document.getElementById("settings-cover");

  const settingsTitle =
    document.getElementById("settings-title");

  const settingsAuthor =
    document.getElementById("settings-author");

  const coverInput =
    document.getElementById("cover-input");

  let activeBook = null;
  let settingsBook = null;
  let selectedCover = null;
  let settingsCoverUrl = null;

  let readerTheme =
    localStorage.getItem("liber-reader-theme") || "dark";


  /* ================================
     READER THEME
     ================================ */

  function applyReaderTheme(theme) {
    readerTheme =
      theme === "light" ? "light" : "dark";

    viewReader.classList.toggle(
      "theme-light",
      readerTheme === "light"
    );

    if (
      activeBook &&
      activeBook.format === "epub"
    ) {
      LiberEpubReader.setTheme(
        readerTheme
      );
    }

    localStorage.setItem(
      "liber-reader-theme",
      readerTheme
    );
  }


  /* ================================
     TOAST
     ================================ */

  function showToast(msg) {
    toast.textContent = msg;
    toast.hidden = false;

    clearTimeout(showToast._t);

    const duration =
      Math.min(
        6000,
        Math.max(2200, msg.length * 60)
      );

    showToast._t =
      setTimeout(
        () => (toast.hidden = true),
        duration
      );
  }


  /* ================================
     FILE TYPE
     ================================ */

  function formatOf(file) {
    const name =
      file.name.toLowerCase();

    if (name.endsWith(".epub")) {
      return "epub";
    }

    if (name.endsWith(".pdf")) {
      return "pdf";
    }

    if (
      file.type ===
      "application/epub+zip"
    ) {
      return "epub";
    }

    if (
      file.type ===
      "application/pdf"
    ) {
      return "pdf";
    }

    return null;
  }


  /* ================================
     COVER GENERATION
     ================================ */

  async function generateCover(
    file,
    format
  ) {
    try {

      if (format === "epub") {

        const tempBook =
          ePub(file);

        await tempBook.opened;

        const url =
          await tempBook.coverUrl();

        let blob = null;

        if (url) {
          const resp =
            await fetch(url);

          blob =
            await resp.blob();
        }

        if (tempBook.destroy) {
          tempBook.destroy();
        }

        return blob;
      }


      if (format === "pdf") {

        await (
          window.LiberPdfjsReady ||
          Promise.resolve()
        );

        if (!window.pdfjsLib) {
          return null;
        }

        const buf =
          await file.arrayBuffer();

        const doc =
          await pdfjsLib
            .getDocument({
              data: buf
            })
            .promise;

        const page =
          await doc.getPage(1);

        const viewport =
          page.getViewport({
            scale: 0.6
          });

        const off =
          document.createElement(
            "canvas"
          );

        off.width =
          viewport.width;

        off.height =
          viewport.height;

        const ctx =
          off.getContext("2d");

        await page.render({
          canvasContext: ctx,
          viewport
        }).promise;

        return await new Promise(
          (resolve) =>
            off.toBlob(
              (b) =>
                resolve(b),
              "image/png",
              0.85
            )
        );
      }

    } catch (e) {

      console.warn(
        "Liber: cover generation failed",
        e
      );

    }

    return null;
  }


  /* ================================
     IMPORT
     ================================ */

  async function importFiles(
    fileList
  ) {

    const files =
      Array.from(fileList);

    for (const file of files) {

      const format =
        formatOf(file);

      if (!format) {

        showToast(
          file.name +
          " isn't an EPUB or PDF"
        );

        continue;
      }

      const id =
        "b_" +
        Date.now() +
        "_" +
        Math.random()
          .toString(36)
          .slice(2, 8);

      const cover =
        await generateCover(
          file,
          format
        );

      const record = {

        id,

        title:
          file.name.replace(
            /\.(epub|pdf)$/i,
            ""
          ),

        author: "",

        format,

        data: file,

        cover,

        /*
         * Every newly imported book
         * starts in TBR.
         */
        status: "tbr",

        addedAt: Date.now(),

        lastOpenedAt: null,

        progress: {}

      };


      try {

        await LiberDB.addBook(
          record
        );

      } catch (e) {

        console.error(
          "Liber: failed to save book",
          file.name,
          e
        );

        let failed = true;

        /*
         * Cover isn't essential.
         * If storage is tight, retry
         * without the cover.
         */

        if (record.cover) {

          try {

            record.cover = null;

            await LiberDB.addBook(
              record
            );

            failed = false;

          } catch (e2) {

            e = e2;

          }

        }

        if (failed) {

          const detail =
            (e &&
              (e.name ||
                e.message)) ||
            String(e);

          showToast(
            "Couldn't save " +
            file.name +
            " — " +
            detail
          );

        }

      }

    }

    await renderLibrary();
  }


  /* ================================
     PROGRESS
     ================================ */

  function progressPercent(book) {

    return (
      (book.progress &&
        book.progress.percent) ||
      0
    );

  }


  /* ================================
     COVER OBJECT URL MANAGEMENT
     ================================ */

  let coverObjectUrls = [];


  function revokeCoverUrls() {

    coverObjectUrls.forEach(
      (url) =>
        URL.revokeObjectURL(url)
    );

    coverObjectUrls = [];
  }


  /* ================================
     STATUS
     ================================ */

  function normalizeStatus(book) {

    /*
     * Old books from before statuses
     * existed are treated as TBR.
     */

    return book.status || "tbr";
  }


  /* ================================
     BOOK CARD
     ================================ */

  function createBookCard(book) {

    const card =
      document.createElement("div");

    card.className =
      "book-card";


    /* COVER */

    const cover =
      document.createElement("div");

    cover.className =
      "book-cover";


    if (book.cover) {

      const img =
        document.createElement("img");

      const objectUrl =
        URL.createObjectURL(
          book.cover
        );

      coverObjectUrls.push(
        objectUrl
      );

      img.src =
        objectUrl;

      img.alt =
        book.title;

      cover.appendChild(img);

    } else {

      const initial =
        document.createElement(
          "span"
        );

      initial.className =
        "initial";

      initial.textContent =
        (book.title || "?")
          .trim()
          .charAt(0)
          .toUpperCase();

      cover.appendChild(
        initial
      );

    }


    /* FORMAT BADGE */

    const badge =
      document.createElement(
        "span"
      );

    badge.className =
      "fmt-badge";

    badge.textContent =
      book.format.toUpperCase();

    cover.appendChild(
      badge
    );


    /* TITLE */

    const title =
      document.createElement(
        "div"
      );

    title.className =
      "book-title";

    title.textContent =
      book.title;


    /* AUTHOR */

    const author =
      document.createElement(
        "div"
      );

    author.className =
      "book-author";

    author.textContent =
      book.author || "";


    /* PROGRESS */

    const progress =
      document.createElement(
        "div"
      );

    progress.className =
      "book-progress";

    const bar =
      document.createElement(
        "i"
      );

    bar.style.width =
      progressPercent(book) +
      "%";

    progress.appendChild(
      bar
    );


    card.appendChild(
      cover
    );

    card.appendChild(
      title
    );

    if (book.author) {

      card.appendChild(
        author
      );

    }

    card.appendChild(
      progress
    );


    /* ============================
       NORMAL TAP
       ============================ */

    let longPressTriggered =
      false;

    card.addEventListener(
      "click",
      (event) => {

        if (longPressTriggered) {

          longPressTriggered =
            false;

          event.preventDefault();

          return;
        }

        openBook(book);

      }
    );


    /* ============================
       LONG PRESS
       ============================ */

    let pressTimer = null;

    card.addEventListener(
      "touchstart",
      () => {

        longPressTriggered =
          false;

        pressTimer =
          setTimeout(() => {

            longPressTriggered =
              true;

            openBookSettings(
              book
            );

          }, 600);

      },
      {
        passive: true
      }
    );


    card.addEventListener(
      "touchend",
      () => {

        if (pressTimer) {

          clearTimeout(
            pressTimer
          );

          pressTimer = null;

        }

      },
      {
        passive: true
      }
    );


    card.addEventListener(
      "touchmove",
      () => {

        if (pressTimer) {

          clearTimeout(
            pressTimer
          );

          pressTimer = null;

        }

      },
      {
        passive: true
      }
    );


    /* Desktop/right-click support */

    card.addEventListener(
      "contextmenu",
      (event) => {

        event.preventDefault();

        openBookSettings(
          book
        );

      },
      {
        passive: false
      }
    );


    return card;
  }


  /* ================================
     HOME SHELVES
     ================================ */

  function fillShelf(
    shelf,
    books,
    emptyElement
  ) {

    shelf.innerHTML = "";

    if (!books.length) {

      emptyElement.hidden =
        false;

      return;

    }

    emptyElement.hidden =
      true;

    books.forEach(
      (book) => {

        shelf.appendChild(
          createBookCard(book)
        );

      }
    );
  }


  /* ================================
     LIBRARY BOOKSHELF
     ================================ */

  function fillBookshelf(
    books
  ) {

    libraryBookshelf.innerHTML =
      "";

    if (!books.length) {

      libraryEmpty.hidden =
        false;

      return;

    }

    libraryEmpty.hidden =
      true;

    books.forEach(
      (book) => {

        const shelfRow =
          document.createElement(
            "div"
          );

        shelfRow.className =
          "bookshelf-row";


        const card =
          createBookCard(
            book
          );

        shelfRow.appendChild(
          card
        );

        libraryBookshelf.appendChild(
          shelfRow
        );

      }
    );
  }


  /* ================================
     RENDER EVERYTHING
     ================================ */

  async function renderLibrary() {

    const books =
      await LiberDB.getAllBooks();

    books.sort(
      (a, b) =>
        (b.lastOpenedAt ||
          b.addedAt) -
        (a.lastOpenedAt ||
          a.addedAt)
    );


    revokeCoverUrls();


    const reading =
      books.filter(
        (book) =>
          normalizeStatus(book) ===
          "reading"
      );


    const tbr =
      books.filter(
        (book) =>
          normalizeStatus(book) ===
          "tbr"
      );


    fillShelf(
      continueShelf,
      reading,
      continueEmpty
    );


    fillShelf(
      tbrShelf,
      tbr,
      tbrEmpty
    );


    fillBookshelf(
      books
    );

  }


  /* ================================
     HOME / LIBRARY NAVIGATION
     ================================ */

  function showHome() {

    homeContent.hidden =
      false;

    allLibrary.hidden =
      true;

    navHome.classList.add(
      "active"
    );

    navLibrary.classList.remove(
      "active"
    );

  }


  function showAllLibrary() {

    homeContent.hidden =
      true;

    allLibrary.hidden =
      false;

    navHome.classList.remove(
      "active"
    );

    navLibrary.classList.add(
      "active"
    );

  }


  /* ================================
     BOOK SETTINGS
     ================================ */

  function renderSettingsCover(
    blob
  ) {

    if (settingsCoverUrl) {

      URL.revokeObjectURL(
        settingsCoverUrl
      );

      settingsCoverUrl =
        null;

    }

    settingsCover.innerHTML =
      "";

    if (!blob) {

      const initial =
        (settingsTitle.value ||
          "?")
          .trim()
          .charAt(0)
          .toUpperCase();

      settingsCover.textContent =
        initial;

      return;
    }


    settingsCoverUrl =
      URL.createObjectURL(
        blob
      );


    const img =
      document.createElement(
        "img"
      );

    img.src =
      settingsCoverUrl;

    img.alt =
      "Book cover";

    settingsCover.appendChild(
      img
    );

  }


  async function openBookSettings(
    book
  ) {

    settingsBook =
      book;

    selectedCover =
      null;


    settingsTitle.value =
      book.title || "";


    settingsAuthor.value =
      book.author || "";


    const status =
      normalizeStatus(book);


    document
      .querySelectorAll(
        'input[name="book-status"]'
      )
      .forEach(
        (input) => {
          input.checked =
            input.value ===
            status;
        }
      );


    renderSettingsCover(
      book.cover
    );


    settingsModal.hidden =
      false;

  }


  function closeSettings() {

    settingsModal.hidden =
      true;

    settingsBook =
      null;

    selectedCover =
      null;

    if (settingsCoverUrl) {

      URL.revokeObjectURL(
        settingsCoverUrl
      );

      settingsCoverUrl =
        null;

    }

  }


  /* ================================
     SAVE SETTINGS
     ================================ */

  async function saveBookSettings() {

    if (!settingsBook) {
      return;
    }


    const selectedStatus =
      document.querySelector(
        'input[name="book-status"]:checked'
      );


    const patch = {

      title:
        settingsTitle.value.trim() ||
        settingsBook.title,

      author:
        settingsAuthor.value.trim(),

      status:
        selectedStatus
          ? selectedStatus.value
          : normalizeStatus(
              settingsBook
            )

    };


    if (selectedCover) {

      patch.cover =
        selectedCover;

    }


    await LiberDB.updateBook(
      settingsBook.id,
      patch
    );


    closeSettings();


    await renderLibrary();


    showToast(
      "Book updated"
    );

  }


  /* ================================
     REMOVE BOOK
     ================================ */

  async function removeBookFromSettings() {

    if (!settingsBook) {
      return;
    }


    const confirmed =
      confirm(
        'Remove "' +
        settingsBook.title +
        '" from your library?'
      );


    if (!confirmed) {
      return;
    }


    await LiberDB.deleteBook(
      settingsBook.id
    );


    closeSettings();


    await renderLibrary();

  }


  /* ================================
     OPEN BOOK
     ================================ */

  async function openBook(book) {

    /*
     * IMPORTANT:
     *
     * Opening a TBR book automatically
     * moves it to Continue Reading.
     */

    if (
      normalizeStatus(book) ===
      "tbr"
    ) {

      await LiberDB.updateBook(
        book.id,
        {
          status: "reading",
          lastOpenedAt:
            Date.now()
        }
      );

      book.status =
        "reading";

      book.lastOpenedAt =
        Date.now();

    } else {

      await LiberDB.updateBook(
        book.id,
        {
          lastOpenedAt:
            Date.now()
        }
      );

      book.lastOpenedAt =
        Date.now();

    }


    activeBook =
      book;


    readerTitle.textContent =
      book.title;


    viewReader.classList.remove(
      "chrome-hidden"
    );


    viewLibrary.classList.remove(
      "active"
    );


    viewReader.classList.add(
      "active"
    );


    if (
      book.format ===
      "epub"
    ) {

      await LiberEpubReader.open(
        book
      );

    } else {

      await LiberPdfReader.open(
        book
      );

    }


    applyReaderTheme(
      readerTheme
    );

  }


  /* ================================
     CLOSE READER
     ================================ */

  function closeReader() {

    if (
      activeBook &&
      activeBook.format ===
        "epub"
    ) {

      LiberEpubReader.destroy();

    }


    if (
      activeBook &&
      activeBook.format ===
        "pdf"
    ) {

      LiberPdfReader.destroy();

    }


    activeBook =
      null;


    viewReader.classList.remove(
      "active",
      "chrome-hidden"
    );


    viewLibrary.classList.add(
      "active"
    );


    tocPanel.hidden =
      true;


    renderLibrary();

  }


  /* ================================
     FILE IMPORT BUTTON
     ================================ */

  document
    .getElementById(
      "btn-add"
    )
    .addEventListener(
      "click",
      () =>
        fileInput.click()
    );


  fileInput.addEventListener(
    "change",
    (event) => {

      if (
        event.target.files.length
      ) {

        importFiles(
          event.target.files
        );

      }

      fileInput.value =
        "";

    }
  );


  /* ================================
     NAVIGATION
     ================================ */

  navHome.addEventListener(
    "click",
    showHome
  );


  navLibrary.addEventListener(
    "click",
    showAllLibrary
  );


  /* ================================
     READER CONTROLS
     ================================ */

  document
    .getElementById(
      "btn-back"
    )
    .addEventListener(
      "click",
      closeReader
    );


  document
    .getElementById(
      "btn-toc"
    )
    .addEventListener(
      "click",
      () => {

        tocPanel.hidden =
          !tocPanel.hidden;

      }
    );


  document
    .getElementById(
      "btn-toc-close"
    )
    .addEventListener(
      "click",
      () => {

        tocPanel.hidden =
          true;

      }
    );


  document
    .getElementById(
      "btn-theme"
    )
    .addEventListener(
      "click",
      () => {

        applyReaderTheme(
          readerTheme ===
            "dark"
            ? "light"
            : "dark"
        );

      }
    );


  /* ================================
     SETTINGS CONTROLS
     ================================ */

  document
    .getElementById(
      "settings-close"
    )
    .addEventListener(
      "click",
      closeSettings
    );


  document
    .getElementById(
      "settings-save"
    )
    .addEventListener(
      "click",
      saveBookSettings
    );


  document
    .getElementById(
      "settings-delete"
    )
    .addEventListener(
      "click",
      removeBookFromSettings
    );


  document
    .getElementById(
      "change-cover"
    )
    .addEventListener(
      "click",
      () =>
        coverInput.click()
    );


  coverInput.addEventListener(
    "change",
    (event) => {

      const file =
        event.target.files &&
        event.target.files[0];

      if (!file) {
        return;
      }


      selectedCover =
        file;


      renderSettingsCover(
        selectedCover
      );


      coverInput.value =
        "";

    }
  );


  /* Click outside modal */

  settingsModal.addEventListener(
    "click",
    (event) => {

      if (
        event.target ===
        settingsModal
      ) {

        closeSettings();

      }

    }
  );


  /* ================================
     READER TAP / CHROME
     ================================ */

  function toggleChrome() {

    if (
      !tocPanel.hidden
    ) {

      tocPanel.hidden =
        true;

      return;

    }


    viewReader.classList.toggle(
      "chrome-hidden"
    );

  }


  document.addEventListener(
    "liber:tap",
    toggleChrome
  );


  /* ================================
     ANDROID BACK BUTTON
     ================================ */

  if (
    window.Capacitor &&
    window.Capacitor.Plugins &&
    window.Capacitor.Plugins.App
  ) {

    window.Capacitor.Plugins.App.addListener(
      "backButton",
      () => {

        if (
          viewReader.classList.contains(
            "active"
          )
        ) {

          if (
            !tocPanel.hidden
          ) {

            tocPanel.hidden =
              true;

            return;

          }


          closeReader();

          return;

        }


        window.Capacitor
          .Plugins
          .App
          .exitApp();

      }
    );

  }


  /* ================================
     PERSISTENT STORAGE
     ================================ */

  if (
    navigator.storage &&
    navigator.storage.persist
  ) {

    navigator.storage
      .persist()
      .catch(() => {});

  }


  /* ================================
     SERVICE WORKER
     ================================ */

  if (
    "serviceWorker" in
    navigator
  ) {

    window.addEventListener(
      "load",
      () => {

        navigator.serviceWorker
          .register("sw.js")
          .catch(() => {});

      }
    );

  }


  /* ================================
     START
     ================================ */

  renderLibrary();

})();
