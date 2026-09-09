/*
 * Vendors epub.js, pdf.js, and JSZip (an epub.js dependency) from node_modules
 * into www/lib/, so the app works fully offline with no CDN dependency.
 * Run automatically via `npm run prepare-libs` (also runs before `npx cap sync`
 * in CI — see .github/workflows/android-build.yml).
 *
 * pdf.js in particular has changed its shipped filenames across versions
 * (pdf.min.mjs vs pdf.mjs vs pdf.min.js, etc), so each candidate lists every
 * filename we've seen in the wild and we use the first one that exists.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const libDir = path.join(root, "www", "lib");

fs.mkdirSync(libDir, { recursive: true });

const copies = [
  {
    to: "epub.min.js",
    candidates: ["node_modules/epubjs/dist/epub.min.js"],
  },
  {
    to: "jszip.min.js",
    candidates: ["node_modules/jszip/dist/jszip.min.js"],
  },
  {
    to: "pdf.min.js",
    candidates: [
      "node_modules/pdfjs-dist/build/pdf.min.mjs",
      "node_modules/pdfjs-dist/build/pdf.mjs",
      "node_modules/pdfjs-dist/build/pdf.min.js",
      "node_modules/pdfjs-dist/build/pdf.js",
    ],
  },
  {
    to: "pdf.worker.min.js",
    candidates: [
      "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
      "node_modules/pdfjs-dist/build/pdf.worker.mjs",
      "node_modules/pdfjs-dist/build/pdf.worker.min.js",
      "node_modules/pdfjs-dist/build/pdf.worker.js",
    ],
  },
];

let missing = [];

for (const c of copies) {
  const found = c.candidates.map((p) => path.join(root, p)).find((p) => fs.existsSync(p));

  if (!found) {
    missing.push(c.candidates[0] + " (or any of its known alternate filenames)");
    continue;
  }
  fs.copyFileSync(found, path.join(libDir, c.to));
  console.log("Vendored " + c.to + "  <-  " + path.relative(root, found));
}

if (missing.length) {
  console.error("\nMissing packages — run `npm install` first:\n" + missing.join("\n"));
  process.exit(1);
}

console.log("\nAll libraries vendored into www/lib/. Liber is ready to run offline.");
