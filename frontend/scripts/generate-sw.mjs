#!/usr/bin/env node
/**
 * Stamps frontend/scripts/sw.template.js with a per-build version and writes
 * the result to frontend/public/sw.js.
 *
 * Why this exists
 * ---------------
 * A service worker is only re-installed when its script bytes change, and the
 * cache names inside it must be unique per build so `activate` can purge the
 * previous build's entries. Both of those need a value that is guaranteed to
 * differ on every deploy -- hence a build-time stamp rather than a constant.
 *
 * Version source, in order of preference:
 *   SW_VERSION       explicit override
 *   GIT_SHA          CI-provided commit sha
 *   <timestamp>      always changes, works inside Docker where .git is absent
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(here, "sw.template.js");
const OUTPUT = resolve(here, "..", "public", "sw.js");

const PLACEHOLDER = "__SW_VERSION__";

function resolveVersion() {
  const explicit = process.env.SW_VERSION || process.env.GIT_SHA;
  if (explicit) {
    // Cache names go into a URL-ish key space; keep the stamp boring.
    return explicit.trim().replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40);
  }
  return `b${Date.now().toString(36)}`;
}

const version = resolveVersion();

const template = await readFile(TEMPLATE, "utf8");

if (!template.includes(PLACEHOLDER)) {
  console.error(
    `[generate-sw] ${TEMPLATE} does not contain ${PLACEHOLDER}. Refusing to write a service worker without a version stamp.`,
  );
  process.exit(1);
}

const output = template.replaceAll(PLACEHOLDER, version);

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, output, "utf8");

console.log(`[generate-sw] wrote public/sw.js  (version: ${version})`);
