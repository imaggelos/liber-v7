# Liber

A simple, minimal, black-and-white e-reader. Supports EPUB (via epub.js) and PDF
(via pdf.js). Offline-first, and packaged as an Android app with Capacitor.

## What's in here

```
liber/
├── www/                      the actual web app (this is Liber itself)
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── db.js              IndexedDB storage (books + reading progress)
│   │   ├── reader-epub.js     epub.js wrapper
│   │   ├── reader-pdf.js      pdf.js wrapper
│   │   └── app.js             library screen + navigation
│   ├── manifest.json          PWA manifest
│   └── sw.js                  service worker (offline caching)
├── scripts/copy-libs.js      vendors epub.js/pdf.js locally for offline use
├── capacitor.config.json     Android app config (name, package id, colors)
├── package.json
└── .github/workflows/android-build.yml   builds Liber.apk automatically
```

## Try it in a browser first (optional)

```
npm install
npm run prepare-libs
npm run serve
```

Then open http://localhost:8080. Tap **+** to add an EPUB or PDF — it's stored
in the browser's IndexedDB, so it stays there (and works offline) after reload.

## Getting Liber.apk — the easy way

You don't need to build anything locally. Just push this project to a GitHub
repo:

1. Create a new GitHub repo and push this whole `liber/` folder to it.
2. GitHub Actions will run automatically (see `.github/workflows/android-build.yml`).
3. Once it finishes (a few minutes), go to the repo's **Actions** tab, open the
   latest run, and download the **Liber.apk** artifact at the bottom of the page.
4. Transfer the APK to your Android phone and install it (you'll need to allow
   "install unknown apps" for whichever app you used to open it).

This build is a debug-signed APK, which is fine for installing on your own
phone. It doesn't need a Play Store listing or your own signing key.

## Building the APK yourself (optional, if you ever add a computer with Android Studio)

```
npm install
npm run prepare-libs
npx cap add android      # first time only
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK will be at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Notes

- **Offline-first**: epub.js, pdf.js, and JSZip are copied into `www/lib/` at
  build time (by `scripts/copy-libs.js`) instead of loaded from a CDN, and the
  service worker caches the whole app shell on first load. Once installed,
  Liber needs no network connection.
- **Storage**: books are stored as blobs in IndexedDB, scoped to the app —
  nothing leaves the device.
- **Library gestures**: tap a book to open it; long-press (or right-click on
  desktop) to remove it.
- **Reader**: continuous vertical scrolling for both EPUB and PDF — just
  scroll to read. The arrow buttons and left/right swipe jump forward/back a
  page for quick navigation. The list icon opens the table of contents.
  Tap anywhere in the text to hide the top/bottom bars for a full-bleed,
  distraction-free view (tap again to bring them back). Pinch to zoom: on
  EPUB this scales the text size and reflows it; on PDF it re-renders the
  pages at the new resolution once you release the pinch.
- **Reading theme**: the circle icon in the reader's top bar toggles between
  dark and light backgrounds for reading, independent of the app's own
  dark shelf UI. For EPUB this recolors the actual text; for PDF, since
  pages are just rendered images, dark mode inverts them (a standard
  "night mode" trick) so the reading area doesn't stay a bright white
  rectangle. Your choice is remembered for next time.
- **Android back button**: inside the app, the hardware/gesture back button
  returns you to the library instead of exiting. From the library itself, it
  exits as normal.
- **Covers**: on import, Liber grabs the book's real cover — from the EPUB's
  metadata, or by rendering a PDF's first page — and uses it as the shelf
  thumbnail. Books without an embedded cover fall back to an initial-letter
  tile.
- **App icon**: `www/icons/icon.svg` is a placeholder. Capacitor will use its
  own default launcher icon unless you generate one — swap it out with
  [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets) later
  if you want a custom one.
