'use strict';

// Stage 0: content-hashed static assets.
//
// Every static asset was previously served with Cache-Control: public, max-age=0,
// must-revalidate (Vercel's default for static output). Measured on production:
// on a repeat visit ALL SIX scripts hit the network and none were served from
// cache -- conditional requests returned 304, so the browser already had the
// bytes but was forbidden from using them without asking first. That is 7 forced
// round trips before a single line of JS can run: invisible at a 15ms desktop RTT,
// but 1.5-2s of blank screen on a phone at 250ms.
//
// A URL can only be cached immutably if its bytes can never change, so the
// filename has to be derived from the content. This step copies each asset to
// public/static/<name>.<hash>.js, records the mapping in public/asset-manifest.json,
// and rewrites index.html to point at those names. vercel.json then applies
// immutable caching to /static/(.*) only.
//
// This REPLACES the hand-maintained ?v= cache-buster, which was the dangerous part
// of the old scheme: it was bumped by hand in two places, so a missed bump under
// immutable caching would pin visitors to a stale bundle permanently. A content
// hash cannot be forgotten.
//
// Deliberately NOT hashed: env-config.js. It is generated per deployment from
// environment variables and served no-store, because a cached copy could point a
// Preview visitor at the production Supabase project. Hashing it would make its
// URL cacheable, which is exactly what must not happen.
//
// The HTML rewrite is idempotent: a reference is normalised back to its logical
// name (dropping any static/ or vendor/ prefix, any existing hash, and any legacy
// ?v= query) before being looked up, so running this step twice converges instead
// of double-prefixing.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Assets whose URLs become immutable. Order is irrelevant; the manifest is sorted.
const HASHED_ASSETS = [
  'vendor/supabase-js.2.114.0.min.js',
  'vendor/react.production.min.js',
  'vendor/react-dom.production.min.js',
  'session-sync.js',
  'app.compiled.js',
];

const STATIC_DIR = 'static';
const HASH_LENGTH = 16;
const ALGORITHM = 'sha256';

function contentHash(buf) {
  return crypto.createHash(ALGORITHM).update(buf).digest('hex');
}

// supabase-js.2.114.0.min.js -> supabase-js.2.114.0.min.<hash>.js
// The stem keeps its own dots; only the final extension is split off.
function hashedFileName(logicalPath, hash) {
  const base = path.basename(logicalPath);
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  return stem + '.' + hash.slice(0, HASH_LENGTH) + ext;
}

// Turns any reference found in the HTML into the manifest key it belongs to, or
// null when it is not one of our hashable assets. This is what makes re-running
// safe: static/app.compiled.<hash>.js and app.compiled.js?v=1 both normalise to
// app.compiled.js.
function normalizeAssetUrl(url) {
  if (!url) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return null; // absolute/external
  const withoutQuery = url.split('#')[0].split('?')[0];
  const base = path.basename(withoutQuery);
  const ext = path.extname(base);
  if (ext !== '.js') return null;
  let stem = base.slice(0, base.length - ext.length);
  stem = stem.replace(new RegExp('\\.[0-9a-f]{' + HASH_LENGTH + '}$'), '');
  return stem + ext;
}

function buildManifest(publicDir, assets) {
  const entries = {};
  for (const rel of assets) {
    const abs = path.join(publicDir, rel);
    if (!fs.existsSync(abs)) {
      throw new Error('[hash-assets] asset is missing, refusing to emit a manifest that lies: ' + rel);
    }
    const buf = fs.readFileSync(abs);
    const sha256 = contentHash(buf);
    const key = path.basename(rel);
    if (entries[key]) {
      throw new Error('[hash-assets] two assets share the basename "' + key + '"; the manifest is keyed by basename');
    }
    entries[key] = {
      source: rel,
      file: STATIC_DIR + '/' + hashedFileName(rel, sha256),
      sha256: sha256,
      bytes: buf.length,
    };
  }
  // Sorted so identical inputs always serialise to identical bytes.
  const sorted = {};
  for (const key of Object.keys(entries).sort()) sorted[key] = entries[key];
  return { algorithm: ALGORITHM, hashLength: HASH_LENGTH, assets: sorted };
}

// Pure: the manifest is the single source of truth for what goes into the HTML.
function rewriteHtml(html, manifest) {
  const replaced = [];
  const out = html.replace(/((?:src|href)=")([^"]+)(")/g, function (match, prefix, url, suffix) {
    const key = normalizeAssetUrl(url);
    if (!key) return match;
    const entry = manifest.assets[key];
    if (!entry) return match;
    replaced.push({ from: url, to: entry.file });
    return prefix + entry.file + suffix;
  });
  return { html: out, replaced: replaced };
}

function findManualVersionQueries(html) {
  return html.match(/(?:src|href)="[^"]*\?v=[^"]*"/g) || [];
}

function hashAssets(options) {
  const opts = options || {};
  const publicDir = opts.publicDir || path.join(__dirname, '..', 'public');
  const htmlPath = opts.htmlPath || path.join(publicDir, 'index.html');
  const manifestPath = opts.manifestPath || path.join(publicDir, 'asset-manifest.json');
  const staticDir = path.join(publicDir, STATIC_DIR);
  const assetList = opts.assets || HASHED_ASSETS;

  const manifest = buildManifest(publicDir, assetList);

  fs.mkdirSync(staticDir, { recursive: true });

  const expected = new Set();
  for (const key of Object.keys(manifest.assets)) {
    const entry = manifest.assets[key];
    const dest = path.join(publicDir, entry.file);
    expected.add(path.basename(entry.file));
    if (fs.existsSync(dest)) {
      // A hashed name must always mean the same bytes. If this ever fires, the
      // hash is not derived from the content and immutable caching is unsafe.
      const existing = contentHash(fs.readFileSync(dest));
      if (existing !== entry.sha256) {
        throw new Error('[hash-assets] ' + entry.file + ' already exists with different bytes; refusing to reuse an immutable filename');
      }
    } else {
      fs.writeFileSync(dest, fs.readFileSync(path.join(publicDir, entry.source)));
    }
  }

  // Drop hashed files from earlier builds so the directory always matches the
  // manifest exactly. Safe because each Vercel deployment has its own filesystem.
  for (const name of fs.readdirSync(staticDir)) {
    if (!expected.has(name)) fs.unlinkSync(path.join(staticDir, name));
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const rewritten = rewriteHtml(fs.readFileSync(htmlPath, 'utf8'), manifest);
  const leftovers = findManualVersionQueries(rewritten.html);
  if (leftovers.length) {
    throw new Error('[hash-assets] manual ?v= cache-buster survived the rewrite: ' + leftovers.join(', '));
  }
  fs.writeFileSync(htmlPath, rewritten.html);

  return { manifest: manifest, replaced: rewritten.replaced, html: rewritten.html };
}

module.exports = {
  HASHED_ASSETS,
  STATIC_DIR,
  HASH_LENGTH,
  ALGORITHM,
  contentHash,
  hashedFileName,
  normalizeAssetUrl,
  buildManifest,
  rewriteHtml,
  findManualVersionQueries,
  hashAssets,
};

if (require.main === module) {
  try {
    const result = hashAssets();
    const names = Object.keys(result.manifest.assets).map(function (k) {
      return result.manifest.assets[k].file;
    });
    console.log('[build] Hashed ' + names.length + ' assets into public/' + STATIC_DIR + '/ and rewrote index.html');
    for (const name of names) console.log('[build]   ' + name);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
