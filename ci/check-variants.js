#!/usr/bin/env node
/**
 * Post-deploy QA: every slide raster has its WebP ladder.
 *
 * For each TRACKED .jpg/.jpeg/.png under assets/img/slides, require at
 * least one TRACKED sibling '<stem>-<width>.webp' (width = digits).
 * Exits 1 listing every source missing its variants. Node builtins only.
 */
'use strict';

const { execFileSync } = require('node:child_process');

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const out = execFileSync('git', ['ls-files', '-z', 'assets/img/slides'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
const files = out.toString('utf8').split('\0').filter(Boolean);

const tracked = new Set(files);
const sources = files.filter(f => /\.(jpe?g|png)$/i.test(f));

// Index tracked webp variants by their stem for O(1) lookups:
// 'dir/name-640.webp' -> stem 'dir/name'
const variantStems = new Set();
const variantRe = /^(.*)-\d+\.webp$/;
for (const f of tracked) {
  const m = variantRe.exec(f);
  if (m) variantStems.add(m[1]);
}

const missing = [];
for (const src of sources) {
  const stem = src.replace(/\.(jpe?g|png)$/i, '');
  if (!variantStems.has(stem)) missing.push(src);
}

for (const src of missing) console.log(`missing webp variant(s): ${src}`);
console.log(`check-variants: ${sources.length} raster source(s) checked — ${missing.length} without a tracked '<stem>-<width>.webp' sibling`);
process.exit(missing.length ? 1 : 0);
