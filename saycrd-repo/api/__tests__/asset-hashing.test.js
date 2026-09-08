'use strict';

/*
 * Stage 0: content-hashed static assets + caching policy.
 *
 * Measured cause on production before this change: on a repeat visit all six
 * scripts hit the network and NONE were served from cache. Every asset returned
 * "public, max-age=0, must-revalidate", and conditional requests returned 304 --
 * the browser held the bytes but had to ask permission first. Seven forced round
 * trips, invisible at a 15ms desktop RTT and ~1.5-2s of blank screen at 250ms.
 *
 * Immutable caching is only safe if a URL's bytes can never change, so these
 * tests exist to protect two invariants that make that true:
 *
 *   1. the filename is derived from the content (so it cannot be forgotten the
 *      way the old hand-bumped ?v= could), and
 *   2. immutable caching is applied ONLY to those hashed filenames -- never to
 *      index.html (which must be re-read to discover a new deployment), never to
 *      env-config.js (which is per-environment and would leak a Preview visitor
 *      into the production Supabase project), and never to API responses.
 *
 * Every structural claim is expressed as a validator function that THROWS, so the
 * negative controls at the bottom can prove each test actually fails when the
 * protection it guards is removed. A test that cannot be made to fail is not
 * evidence -- and in this repo a faulty control has already been mistaken for a
 * passing one, so the controls here mutate real inputs and assert the throw.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const build = require('../../build/hash-assets.js');

const REPO = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(REPO, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');
const VERCEL_JSON = path.join(REPO, 'vercel.json');

const vercelConfig = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8'));
const committedHtml = fs.readFileSync(INDEX_HTML, 'utf8');

/* ───────────────────────── helpers ───────────────────────── */

// Emulates the subset of Vercel's `source` syntax this config uses: literal paths
// with optional "(.*)" wildcards. Split-then-escape so the wildcard survives but
// regex metacharacters in the literal parts (the dots) do not.
function matchSource(source, urlPath) {
  const parts = source.split('(.*)').map(function (p) {
    return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp('^' + parts.join('.*') + '$').test(urlPath);
}

// Last matching rule wins, mirroring how a later header entry overrides an earlier
// one for the same key.
function cacheControlFor(config, urlPath) {
  let value = null;
  for (const rule of config.headers || []) {
    if (!matchSource(rule.source, urlPath)) continue;
    const header = (rule.headers || []).find(function (h) {
      return String(h.key).toLowerCase() === 'cache-control';
    });
    if (header) value = header.value;
  }
  return value;
}

const IMMUTABLE = /immutable/;

function assertHashedAssetsAreImmutable(config) {
  const value = cacheControlFor(config, '/static/app.compiled.0123456789abcdef.js');
  if (!value) throw new Error('hashed assets have no Cache-Control rule at all');
  if (!IMMUTABLE.test(value)) throw new Error('hashed assets are not immutable: ' + value);
  const maxAge = value.match(/max-age=(\d+)/);
  if (!maxAge || Number(maxAge[1]) < 31536000) {
    throw new Error('hashed assets are not cached for at least a year: ' + value);
  }
}

function assertIndexHtmlRevalidates(config) {
  for (const urlPath of ['/', '/index.html']) {
    const value = cacheControlFor(config, urlPath);
    if (!value) throw new Error('index.html has no explicit cache policy at ' + urlPath);
    if (IMMUTABLE.test(value)) {
      throw new Error('index.html is immutable at ' + urlPath + ', so a new deployment is never discovered: ' + value);
    }
    if (!/must-revalidate|no-cache|no-store/.test(value)) {
      throw new Error('index.html is not revalidated at ' + urlPath + ': ' + value);
    }
  }
}

function assertEnvConfigIsNoStore(config) {
  const value = cacheControlFor(config, '/env-config.js');
  if (value !== 'no-store') {
    throw new Error('env-config.js must stay no-store (it is per-environment), got: ' + String(value));
  }
}

function assertApiIsNotImmutable(config) {
  for (const urlPath of ['/api/credits', '/api/square-checkout', '/api/checkout-availability', '/api/claude']) {
    const value = cacheControlFor(config, urlPath);
    if (value && IMMUTABLE.test(value)) {
      throw new Error('API response is immutable at ' + urlPath + ': ' + value);
    }
  }
}

function assertNoManualVersionQuery(html) {
  const found = build.findManualVersionQueries(html);
  if (found.length) throw new Error('manual ?v= asset references remain: ' + found.join(', '));
}

// The manifest is the single source of truth: every hashed reference in the HTML
// must come from it, and every file it names must exist on disk.
function assertManifestMatchesHtml(html, manifest, publicDir) {
  const refs = [];
  const re = /(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].indexOf(build.STATIC_DIR + '/') === 0) refs.push(m[1]);
  }
  const distinct = new Set(refs);
  if (distinct.size === 0) throw new Error('the HTML references no hashed assets, so nothing was rewritten');

  const manifestFiles = new Set(Object.keys(manifest.assets).map(function (k) {
    return manifest.assets[k].file;
  }));

  for (const ref of distinct) {
    if (!manifestFiles.has(ref)) throw new Error('HTML references ' + ref + ', which the manifest does not list');
    if (!fs.existsSync(path.join(publicDir, ref))) throw new Error('HTML references ' + ref + ', which is not on disk');
  }
  for (const file of manifestFiles) {
    if (!fs.existsSync(path.join(publicDir, file))) throw new Error('manifest lists ' + file + ', which is not on disk');
  }
}

/* ── fixtures: build against a temp copy so the repo is never mutated ── */

const tempDirs = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saycrd-stage0-'));
  tempDirs.push(dir);
  return dir;
}

process.on('exit', function () {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

// A miniature public/ with the same shape as the real one (a vendor subdirectory,
// a root-level script, a compiled bundle) and an index.html that references them
// the way the committed one does.
function makeFixture(overrides) {
  const dir = tempDir();
  const files = Object.assign({
    'vendor/react.production.min.js': 'react-bytes',
    'session-sync.js': 'sync-bytes',
    'app.compiled.js': 'bundle-bytes',
  }, overrides || {});
  for (const rel of Object.keys(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, files[rel]);
  }
  fs.writeFileSync(path.join(dir, 'index.html'), [
    '<!doctype html><html><head>',
    '<link rel="preload" href="app.compiled.js" as="script">',
    '<link rel="preload" href="env-config.js" as="script">',
    '<!-- prose mentioning app.compiled.js must not be rewritten -->',
    '</head><body>',
    '<script src="vendor/react.production.min.js"></script>',
    '<script src="env-config.js"></script>',
    '<script src="session-sync.js"></script>',
    '<script src="app.compiled.js"></script>',
    '</body></html>',
  ].join('\n'));
  return dir;
}

const FIXTURE_ASSETS = ['vendor/react.production.min.js', 'session-sync.js', 'app.compiled.js'];

function runFixtureBuild(dir) {
  return build.hashAssets({ publicDir: dir, assets: FIXTURE_ASSETS });
}

/* ───────────────────────── required tests ───────────────────────── */

test('a changed source file produces a new hashed filename', () => {
  const dir = makeFixture();
  const before = runFixtureBuild(dir).manifest.assets['app.compiled.js'];

  fs.writeFileSync(path.join(dir, 'app.compiled.js'), 'bundle-bytes-CHANGED');
  const after = runFixtureBuild(dir).manifest.assets['app.compiled.js'];

  assert.notStrictEqual(after.file, before.file,
    'changed bytes kept the same URL, so immutable caching would serve the old bundle forever');
  assert.notStrictEqual(after.sha256, before.sha256);
  assert.ok(fs.existsSync(path.join(dir, after.file)), 'the new hashed file was not written');
  assert.ok(!fs.existsSync(path.join(dir, before.file)),
    'the superseded hashed file was not pruned, so the directory drifts from the manifest');
});

test('identical source produces the same filename and the same bytes', () => {
  const dir = makeFixture();
  const first = runFixtureBuild(dir);
  const second = runFixtureBuild(dir);

  assert.deepStrictEqual(second.manifest, first.manifest, 'the manifest is not stable across builds');
  for (const key of Object.keys(first.manifest.assets)) {
    const entry = first.manifest.assets[key];
    assert.strictEqual(second.manifest.assets[key].file, entry.file);
    assert.strictEqual(
      fs.readFileSync(path.join(dir, entry.file), 'utf8'),
      fs.readFileSync(path.join(dir, entry.source), 'utf8'),
      'the hashed copy does not match its source bytes');
  }
});

test('the manifest and index.html reference the same existing files', () => {
  const dir = makeFixture();
  const result = runFixtureBuild(dir);
  assertManifestMatchesHtml(result.html, result.manifest, dir);

  const written = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.strictEqual(written, result.html, 'the HTML on disk differs from what the build returned');

  const manifestOnDisk = JSON.parse(fs.readFileSync(path.join(dir, 'asset-manifest.json'), 'utf8'));
  assert.deepStrictEqual(manifestOnDisk, result.manifest, 'the manifest on disk differs from what the build returned');
});

test('no manual ?v= asset references remain in the committed index.html', () => {
  assertNoManualVersionQuery(committedHtml);
});

test('the rewrite is idempotent and leaves non-asset references alone', () => {
  const dir = makeFixture();
  const once = runFixtureBuild(dir);
  const twice = runFixtureBuild(dir);
  assert.strictEqual(twice.html, once.html, 'running the build twice changed the HTML again');

  // env-config.js is deliberately excluded from hashing: it is per-environment and
  // served no-store, so giving it a cacheable URL could point a Preview visitor at
  // the production Supabase project.
  assert.ok(once.html.includes('src="env-config.js"'), 'env-config.js must not be hashed');
  assert.ok(once.html.includes('href="env-config.js"'), 'the env-config.js preload must not be hashed');
  assert.ok(once.html.includes('<!-- prose mentioning app.compiled.js must not be rewritten -->'),
    'the rewrite touched prose instead of only src/href attributes');
});

test('a hashed filename is never reused for different bytes', () => {
  const dir = makeFixture();
  const result = runFixtureBuild(dir);
  const entry = result.manifest.assets['app.compiled.js'];

  // Corrupt the emitted file while keeping its name, then rebuild: the guard must
  // refuse rather than silently serve wrong bytes under an immutable URL.
  fs.writeFileSync(path.join(dir, entry.file), 'DIFFERENT');
  assert.throws(function () { runFixtureBuild(dir); }, /refusing to reuse an immutable filename/);
});

test('a clean build is deterministic on the real assets', () => {
  const a = tempDir();
  const b = tempDir();
  for (const dir of [a, b]) {
    for (const rel of build.HASHED_ASSETS) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.copyFileSync(path.join(PUBLIC_DIR, rel), abs);
    }
    fs.copyFileSync(INDEX_HTML, path.join(dir, 'index.html'));
  }
  const first = build.hashAssets({ publicDir: a });
  const second = build.hashAssets({ publicDir: b });

  assert.deepStrictEqual(second.manifest, first.manifest,
    'two clean builds of identical sources produced different manifests');
  assert.strictEqual(second.html, first.html,
    'two clean builds of identical sources produced different HTML');
  assertManifestMatchesHtml(first.html, first.manifest, a);
  assertNoManualVersionQuery(first.html);
});

test('every asset index.html loads is either hashed or explicitly exempt', () => {
  const dir = tempDir();
  for (const rel of build.HASHED_ASSETS) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.copyFileSync(path.join(PUBLIC_DIR, rel), abs);
  }
  fs.copyFileSync(INDEX_HTML, path.join(dir, 'index.html'));
  const result = build.hashAssets({ publicDir: dir });

  // Anchored on src=/href= and checked against the stripped set, because the real
  // index.html mentions these filenames in prose comments too.
  const re = /(?:src|href)="([^"]+)"/g;
  const exempt = ['env-config.js'];
  let m;
  while ((m = re.exec(result.html)) !== null) {
    const url = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) continue; // external
    if (!url.endsWith('.js')) continue;
    if (exempt.includes(url)) continue;
    assert.ok(url.indexOf(build.STATIC_DIR + '/') === 0,
      'index.html loads ' + url + ', which is neither content-hashed nor exempt');
  }
});

/* ───────────────────────── caching policy ───────────────────────── */

test('hashed assets receive immutable caching', () => {
  assertHashedAssetsAreImmutable(vercelConfig);
});

test('index.html does not receive immutable caching', () => {
  assertIndexHtmlRevalidates(vercelConfig);
});

test('env-config.js remains no-store', () => {
  assertEnvConfigIsNoStore(vercelConfig);
});

test('API routes do not receive immutable caching', () => {
  assertApiIsNotImmutable(vercelConfig);
});

test('the immutable rule cannot match anything that is not a hashed asset', () => {
  for (const urlPath of ['/', '/index.html', '/env-config.js', '/app.compiled.js', '/api/credits', '/vercel.json']) {
    const value = cacheControlFor(vercelConfig, urlPath);
    assert.ok(!(value && IMMUTABLE.test(value)),
      urlPath + ' is served immutable but is not a content-hashed asset: ' + value);
  }
});

/* ───────────────────────── negative controls ─────────────────────────
 *
 * Each control removes exactly one protection and asserts the corresponding
 * validator throws. Without these, a validator that can never fail would look
 * identical to a passing test.
 */

function withoutRule(config, source) {
  const clone = JSON.parse(JSON.stringify(config));
  clone.headers = clone.headers.filter(function (r) { return r.source !== source; });
  return clone;
}

function withRule(config, source, value) {
  const clone = JSON.parse(JSON.stringify(config));
  clone.headers.push({ source: source, headers: [{ key: 'Cache-Control', value: value }] });
  return clone;
}

test('negative control: dropping the /static rule fails the immutable test', () => {
  const broken = withoutRule(vercelConfig, '/static/(.*)');
  assert.notStrictEqual(
    JSON.stringify(broken.headers), JSON.stringify(vercelConfig.headers),
    'the mutation did not land, so this control proves nothing');
  assert.throws(function () { assertHashedAssetsAreImmutable(broken); }, /no Cache-Control rule at all/);
});

test('negative control: a short max-age on /static fails the immutable test', () => {
  const broken = withRule(withoutRule(vercelConfig, '/static/(.*)'), '/static/(.*)', 'public, max-age=600, immutable');
  assert.throws(function () { assertHashedAssetsAreImmutable(broken); }, /not cached for at least a year/);
});

test('negative control: making index.html immutable fails the revalidation test', () => {
  const broken = withRule(vercelConfig, '/index.html', 'public, max-age=31536000, immutable');
  assert.throws(function () { assertIndexHtmlRevalidates(broken); }, /is immutable at \/index\.html/);
});

test('negative control: dropping the index.html rules fails the revalidation test', () => {
  const broken = withoutRule(withoutRule(vercelConfig, '/index.html'), '/');
  assert.throws(function () { assertIndexHtmlRevalidates(broken); }, /no explicit cache policy/);
});

test('negative control: caching env-config.js fails the no-store test', () => {
  const broken = withRule(vercelConfig, '/env-config.js', 'public, max-age=31536000, immutable');
  assert.throws(function () { assertEnvConfigIsNoStore(broken); }, /must stay no-store/);
});

test('negative control: an immutable /api rule fails the API test', () => {
  const broken = withRule(vercelConfig, '/api/(.*)', 'public, max-age=31536000, immutable');
  assert.throws(function () { assertApiIsNotImmutable(broken); }, /API response is immutable/);
});

test('negative control: a ?v= reference fails the no-manual-version test', () => {
  // Matched by pattern rather than by literal, so the mutation lands whether
  // index.html is in its committed (plain-name) state or the post-build (hashed)
  // state. A literal 'href="app.compiled.js"' silently no-ops after a build, and
  // a control whose mutation never landed proves nothing while still going green.
  const broken = committedHtml.replace(
    /(href|src)="((?:static\/)?app\.compiled(?:\.[0-9a-f]{16})?\.js)"/,
    '$1="$2?v=20260907-14"');
  assert.notStrictEqual(broken, committedHtml, 'the mutation did not land, so this control proves nothing');
  assert.throws(function () { assertNoManualVersionQuery(broken); }, /manual \?v= asset references remain/);
});

test('negative control: a manifest missing an asset fails the consistency test', () => {
  const dir = makeFixture();
  const result = runFixtureBuild(dir);
  const broken = JSON.parse(JSON.stringify(result.manifest));
  delete broken.assets['app.compiled.js'];
  assert.throws(function () { assertManifestMatchesHtml(result.html, broken, dir); },
    /which the manifest does not list/);
});

test('negative control: a manifest entry with no file on disk fails the consistency test', () => {
  const dir = makeFixture();
  const result = runFixtureBuild(dir);
  fs.unlinkSync(path.join(dir, result.manifest.assets['app.compiled.js'].file));
  assert.throws(function () { assertManifestMatchesHtml(result.html, result.manifest, dir); },
    /is not on disk/);
});

test('negative control: an un-rewritten HTML fails the consistency test', () => {
  const dir = makeFixture();
  const result = runFixtureBuild(dir);
  const unrewritten = '<script src="app.compiled.js"></script>';
  assert.throws(function () { assertManifestMatchesHtml(unrewritten, result.manifest, dir); },
    /references no hashed assets/);
});
