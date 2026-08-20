#!/usr/bin/env node
/**
 * Rasterises the app logo into the PNG icons that installed-app surfaces need.
 *
 * Why PNGs exist alongside the SVGs
 * --------------------------------
 * Safari ignores an SVG `apple-touch-icon` outright, so an iPhone that adds the
 * app to its home screen falls back to a screenshot of the page. Android splash
 * screens and WebAPK generation likewise want concrete 192/512 raster sizes.
 * The SVGs stay as the source of truth; these are generated from them.
 *
 * This is deliberately NOT part of `pnpm build`: the output only changes when
 * the logo changes, and wiring `sharp` into every install (a native binary)
 * to redraw four static files on every deploy is not a trade worth making.
 *
 * Regenerate after editing public/logo.svg or public/logo-maskable.svg:
 *
 *   # sharp is not a declared dependency; point node at any copy of it
 *   NODE_PATH=../node_modules/.pnpm/sharp@0.33.5/node_modules \
 *     node scripts/generate-icons.mjs
 *
 * Then commit the PNGs.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(here, "..", "public");

const require = createRequire(import.meta.url);

let sharp;
try {
  sharp = require("sharp");
} catch (err) {
  console.error(
    "[generate-icons] sharp is not resolvable. Re-run with NODE_PATH pointing\n" +
      "                at a directory containing it, e.g.\n" +
      "                NODE_PATH=../node_modules/.pnpm/sharp@0.33.5/node_modules node scripts/generate-icons.mjs",
  );
  process.exit(1);
}

/** Flattened onto white: iOS masks the corners itself and alpha there renders black. */
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

const JOBS = [
  { source: "logo.svg", out: "icon-192.png", size: 192 },
  { source: "logo.svg", out: "icon-512.png", size: 512 },
  // Already drawn with the 80% safe-zone inset an Android circle mask needs.
  { source: "logo-maskable.svg", out: "icon-maskable-512.png", size: 512, fullBleed: true },
  { source: "logo.svg", out: "apple-touch-icon.png", size: 180 },
];

/**
 * A maskable icon supplies the artwork, not the silhouette: the launcher clips
 * it to whatever shape the device uses. Leaving the rounded card in would show
 * as a stray arc sliced by a circle mask, so square off the plate and drop its
 * border, and let the mask draw the edge.
 */
function squareOffPlate(svgText) {
  const withoutBorder = svgText.replace(
    /\s*<rect[^>]*stroke="#00807A"[^>]*\/>\n?/,
    "\n",
  );
  if (withoutBorder === svgText) {
    throw new Error(
      "[generate-icons] expected a bordered plate rect in the maskable source; " +
        "the SVG changed shape, so this transform needs revisiting.",
    );
  }
  return withoutBorder.replace(/(<rect[^>]*?)\srx="112"/, "$1");
}

for (const job of JOBS) {
  const raw = await readFile(resolve(PUBLIC, job.source), "utf8");
  const svg = Buffer.from(job.fullBleed ? squareOffPlate(raw) : raw, "utf8");

  const png = await sharp(svg, { density: 512 })
    .resize(job.size, job.size, { fit: "contain", background: WHITE })
    .flatten({ background: WHITE })
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(resolve(PUBLIC, job.out), png);
  console.log(`[generate-icons] wrote public/${job.out}  (${job.size}x${job.size}, from ${job.source})`);
}
