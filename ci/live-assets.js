#!/usr/bin/env node
/**
 * Post-deploy QA: every asset the published site references must resolve.
 *
 * Usage: node ci/live-assets.js [originUrl]
 *   originUrl defaults to https://eng-dvco.github.io/presentation/
 *
 * Enumerates TRACKED files (git ls-files), extracts same-site relative
 * references from HTML (src/href/poster/srcset), styles/**.css (url(...))
 * and history/history-indefinida.json (src/miniatura), then HEADs each
 * resolved path against the origin. Exits 1 if any reference fails.
 * public/snapshots/** is excluded wholesale (as source and as target).
 * Node builtins only (requires node >= 18 for global fetch).
 */
'use strict';

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const TRACKED_ONLY = process.argv.includes('--tracked');
const posArgs = process.argv.slice(2).filter(a => !a.startsWith('--'));
const ORIGIN = (posArgs[0] || 'https://eng-dvco.github.io/presentation/').replace(/\/+$/, '') + '/';
const CONCURRENCY = 10;

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

// ---- reference extraction -------------------------------------------------

function isExternal(ref) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref); // http(s):, data:, mailto:, tel:, javascript:, protocol-relative, pure fragment
}

function cleanRef(ref) {
  // strip fragment and query, trim whitespace
  return ref.trim().replace(/[#?].*$/s, '');
}

/** Resolve `ref` against directory of `fromFile` (repo-relative, posix). Returns repo-relative path or null. */
function resolveRef(ref, fromFile) {
  const clean = cleanRef(ref);
  if (!clean || isExternal(clean)) return null;
  let decoded = clean;
  try { decoded = decodeURIComponent(clean); } catch { /* keep raw */ }
  const baseDir = decoded.startsWith('/') ? '' : path.posix.dirname(fromFile);
  const joined = decoded.startsWith('/')
    ? decoded.replace(/^\/+/, '')
    : path.posix.normalize(path.posix.join(baseDir === '.' ? '' : baseDir, decoded));
  if (!joined || joined.startsWith('..')) return null; // escapes the site root
  return joined;
}

function extractFromHtml(text) {
  const refs = [];
  const attrRe = /\b(src|href|poster|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
  let m;
  while ((m = attrRe.exec(text)) !== null) {
    const attr = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    if (!value) continue;
    if (attr === 'srcset') {
      for (const candidate of value.split(',')) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) refs.push(url);
      }
    } else {
      refs.push(value);
    }
  }
  return refs;
}

function extractFromCss(text) {
  const refs = [];
  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (value) refs.push(value);
  }
  return refs;
}

/**
 * Walk the history JSON for every "src" and "miniatura" value.
 * "miniatura" is the only field the history page actually fetches; "src" is a
 * historical record of the file AT THAT COMMIT (files get renamed, relocated
 * with the thumb archived into history/thumbs/, or re-extensioned), so a src
 * is only probed when it is still a tracked file — see addRef call site.
 */
function extractFromHistoryJson(text) {
  const srcs = [];
  const miniaturas = [];
  (function walk(node) {
    if (Array.isArray(node)) { for (const v of node) walk(v); return; }
    if (node && typeof node === 'object') {
      if (typeof node.src === 'string' && node.src) srcs.push(node.src);
      if (typeof node.miniatura === 'string' && node.miniatura) miniaturas.push(node.miniatura);
      for (const v of Object.values(node)) walk(v);
    }
  })(JSON.parse(text));
  return { srcs, miniaturas };
}

// ---- collect --------------------------------------------------------------

const files = trackedFiles();
const trackedSet = new Set(files);
const targets = new Map(); // repoRelPath -> first referencing file
let skippedHistorical = 0;

function addRef(ref, fromFile, opts = {}) {
  const resolved = opts.resolveAgainstRoot
    ? resolveRef(ref, 'ROOT_FILE_PLACEHOLDER') // dirname('ROOT_FILE_PLACEHOLDER') === '.'
    : resolveRef(ref, fromFile);
  if (!resolved) return;
  if (resolved.startsWith('public/snapshots/')) return; // snapshots excluded wholesale
  if (opts.onlyIfTracked && !trackedSet.has(resolved)) { skippedHistorical++; return; }
  if (!targets.has(resolved)) targets.set(resolved, fromFile);
}

for (const file of files) {
  if (file.startsWith('public/snapshots/')) continue;
  if (file.endsWith('.html')) {
    const text = readFileSync(path.join(repoRoot, file), 'utf8');
    for (const ref of extractFromHtml(text)) addRef(ref, file);
  } else if (file.startsWith('styles/') && file.endsWith('.css')) {
    const text = readFileSync(path.join(repoRoot, file), 'utf8');
    for (const ref of extractFromCss(text)) addRef(ref, file);
  }
}

{
  const historyFile = 'history/history-indefinida.json';
  if (trackedSet.has(historyFile)) {
    const text = readFileSync(path.join(repoRoot, historyFile), 'utf8');
    // src/miniatura values are repo-root-relative
    const { srcs, miniaturas } = extractFromHistoryJson(text);
    for (const ref of miniaturas) addRef(ref, historyFile, { resolveAgainstRoot: true });
    for (const ref of srcs) addRef(ref, historyFile, { resolveAgainstRoot: true, onlyIfTracked: true });
  }
}

// ---- probe ----------------------------------------------------------------

function encodePath(repoRel) {
  return repoRel.split('/').map(encodeURIComponent).join('/');
}

async function probe(repoRel) {
  const url = ORIGIN + encodePath(repoRel);
  const attempt = async (method) => {
    const res = await fetch(url, { method, redirect: 'follow' });
    if (method === 'HEAD' && (res.status === 405 || res.status === 501)) {
      const res2 = await fetch(url, { method: 'GET', redirect: 'follow' });
      try { res2.body?.cancel?.(); } catch { /* ignore */ }
      return res2.status;
    }
    if (method === 'GET') { try { res.body?.cancel?.(); } catch { /* ignore */ } }
    return res.status;
  };
  try {
    let status = await attempt('HEAD');
    if (status === 429 || status >= 500) {
      await new Promise(r => setTimeout(r, 1000));
      status = await attempt('HEAD');
    }
    return status;
  } catch (err) {
    try {
      await new Promise(r => setTimeout(r, 1000));
      return await attempt('HEAD');
    } catch (err2) {
      return `ERR(${err2.code || err2.cause?.code || err2.message})`;
    }
  }
}

async function main() {
  const entries = [...targets.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);

  // --tracked: offline shift-left — resolve every reference against the git
  // index instead of probing the live site (0.2s; same extraction, so a miss
  // here is exactly the class of 404 the live probe would find post-deploy).
  if (TRACKED_ONLY) {
    const misses = entries.filter(([repoRel]) => !trackedSet.has(repoRel))
      .map(([repoRel, referrer]) => `NOT-TRACKED ${repoRel}  <- referenced by ${referrer}`).sort();
    for (const line of misses) console.log(line);
    console.log(`live-assets --tracked: ${entries.length} referenced paths resolved against the git index — ${misses.length} missing` + (skippedHistorical ? ` (${skippedHistorical} historical history-json src refs skipped)` : ''));
    process.exit(misses.length ? 1 : 0);
  }
  let failures = [];
  let cursor = 0;
  async function worker() {
    while (cursor < entries.length) {
      const [repoRel, referrer] = entries[cursor++];
      const status = await probe(repoRel);
      if (typeof status !== 'number' || status < 200 || status >= 400) {
        failures.push({ status, repoRel, referrer });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

  // A run triggered right after a deploy can race CDN propagation: brand-new
  // files may 404 for a few seconds. Re-probe 404s once after a settle delay
  // before declaring failure (skipped when nothing 404ed).
  if (failures.some(f => f.status === 404)) {
    const delayMs = Number(process.env.LIVE_ASSETS_404_RETRY_MS ?? 30000);
    console.log(`retrying ${failures.filter(f => f.status === 404).length} 404(s) after ${delayMs / 1000}s (CDN propagation settle)...`);
    await new Promise(r => setTimeout(r, delayMs));
    const still = [];
    for (const f of failures) {
      if (f.status !== 404) { still.push(f); continue; }
      const status = await probe(f.repoRel);
      if (typeof status !== 'number' || status < 200 || status >= 400) still.push({ ...f, status });
    }
    failures = still;
  }

  const lines = failures.map(f => `${f.status} ${f.repoRel}  <- referenced by ${f.referrer}`).sort();
  for (const line of lines) console.log(line);
  console.log(`live-assets: ${entries.length} referenced paths checked against ${ORIGIN} — ${failures.length} failure(s)` + (skippedHistorical ? ` (${skippedHistorical} historical history-json src refs skipped)` : ''));
  process.exit(failures.length ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
