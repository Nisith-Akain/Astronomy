#!/usr/bin/env node
// Builds a single self-contained main.html that can be opened directly via
// file:// (double-click), with no dev/preview server needed.
//
// It does NOT modify any app source. It runs the normal `vite build`, then
// post-processes the dist/ output text: every relative asset the app loads
// at runtime (planets.json, planet/ring textures, the probe .glb, the
// favicon) is inlined as a base64 data: URI, and the built JS/CSS are
// inlined into the HTML. Data: URIs avoid the WebGL "tainted canvas" /
// cross-origin error that plain file:// texture paths hit in three.js.
//
// This script hard-codes the exact literal patterns the current build
// produces (verified against dist/assets/index-*.js): the two build-time-
// folded template literals `./data/planets.json` and `./models/probe.glb`,
// and the one runtime-concatenated `` `./`+t `` used by the texture loader.
// If the app's asset-loading code changes, re-check these patterns.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
// `npm run build:onefile` runs `vite build` first (see package.json); this
// script only post-processes the resulting dist/.

function dataUri(mime, filePath) {
  return `data:${mime};base64,${readFileSync(filePath).toString('base64')}`;
}

// --- 1. Rewrite planets.json so every texture path is itself a data: URI ---
const planetsPath = join(dist, 'data', 'planets.json');
const planets = JSON.parse(readFileSync(planetsPath, 'utf8'));
const texMime = (p) => (p.endsWith('.png') ? 'image/png' : 'image/jpeg');
const inlineTexture = (relPath) => dataUri(texMime(relPath), join(dist, relPath));

planets.sun.texture = inlineTexture(planets.sun.texture);
for (const p of planets.planets) {
  p.texture = inlineTexture(p.texture);
  if (p.ring) p.ring.texture = inlineTexture(p.ring.texture);
}
const planetsDataUri = `data:application/json;base64,${Buffer.from(JSON.stringify(planets)).toString('base64')}`;

// --- 2. The probe model and favicon, as data: URIs ---
const probeDataUri = dataUri('model/gltf-binary', join(dist, 'models', 'probe.glb'));
const faviconDataUri = dataUri('image/svg+xml', join(dist, 'favicon.svg'));

// --- 3. Find the built JS/CSS (hashed filenames) ---
const assetsDir = join(dist, 'assets');
const jsFile = readdirSync(assetsDir).find((f) => f.endsWith('.js'));
const cssFile = readdirSync(assetsDir).find((f) => f.endsWith('.css'));
if (!jsFile || !cssFile) throw new Error('[build-onefile] could not find built JS/CSS in dist/assets');

let js = readFileSync(join(assetsDir, jsFile), 'utf8');
const css = readFileSync(join(assetsDir, cssFile), 'utf8');

// --- 4. Patch the JS text: replace the three asset-loading call sites ---
const patch = (label, pattern, replacement) => {
  const count = js.split(pattern).length - 1;
  if (count !== 1) {
    throw new Error(
      `[build-onefile] expected exactly 1 occurrence of ${label} (${JSON.stringify(pattern)}), found ${count}. ` +
        'The app source has likely changed; update scripts/build-onefile.mjs.',
    );
  }
  js = js.split(pattern).join(replacement);
};

patch('planets.json fetch literal', '`./data/planets.json`', '`' + planetsDataUri + '`');
patch('probe.glb literal', '`./models/probe.glb`', '`' + probeDataUri + '`');
// Runtime concat used only by the per-texture loader: `` `./`+t `` -> `t`
// (t already holds a full data: URI once it comes from the rewritten JSON).
patch('base-URL texture prefix', '`./`+', '');
// Strip the external sourcemap reference (dist/assets/*.js.map isn't shipped).
js = js.replace(/\/\/# sourceMappingURL=.*$/m, '');

// --- 5. Build the single HTML file ---
let html = readFileSync(join(dist, 'index.html'), 'utf8');
html = html.replace('href="./favicon.svg"', `href="${faviconDataUri}"`);
// Use function replacers, not string replacements: a string replacement
// argument gives `$&`, `` $` ``, `$'`, `$$` special meaning in
// String.prototype.replace, and 665 KB of minified JS is near-certain to
// contain one of those two-character sequences somewhere, which would
// silently splice bits of the original html back in.
html = html.replace(
  /<script type="module" crossorigin src="\.\/assets\/[^"]+"><\/script>/,
  () => `<script type="module">\n${js}\n</script>`,
);
html = html.replace(
  /<link rel="stylesheet" crossorigin href="\.\/assets\/[^"]+">/,
  () => `<style>\n${css}\n</style>`,
);
if (html.includes('crossorigin src="./assets') || html.includes('crossorigin href="./assets')) {
  throw new Error('[build-onefile] failed to inline the built JS/CSS tags — check dist/index.html shape.');
}
const doctypeCount = html.split('<!doctype html>').length - 1;
if (doctypeCount !== 1) {
  throw new Error(
    `[build-onefile] expected exactly one <!doctype html> in the output, found ${doctypeCount} — ` +
      'the html was likely corrupted while splicing in the JS/CSS.',
  );
}

const outPath = join(root, 'main.html');
writeFileSync(outPath, html, 'utf8');
const sizeMb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
console.log(`[build-onefile] wrote ${outPath} (${sizeMb} MB)`);
