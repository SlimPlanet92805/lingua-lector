'use strict';

// Loads the built single-file app and makes its inner functions reachable from
// tests.
//
// The app has no module system by design (it must run from a file:// double
// click with no build step), so there is nothing to `require`. Instead the
// inline <script> blocks are pulled out of dist/lingua-lector.html and
// evaluated in a `vm` context with just enough browser surface stubbed for the
// load-time statements to succeed. Tests then reach the app's globals directly.
//
// Testing the *built* artifact rather than the src/ fragments is deliberate:
// it means the tests also cover build.py's concatenation and placeholder
// injection, which is where a whole class of breakage lives.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist', 'lingua-lector.html');

function readDist() {
  if (!fs.existsSync(DIST)) {
    throw new Error(`${DIST} not found — run "python build.py" first`);
  }
  return fs.readFileSync(DIST, 'utf8');
}

// Inline scripts only. External <script src="..."> tags (the CDN libraries)
// have no body and are skipped.
function extractScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/i.test(m[1])) continue;
    if (m[2].trim()) out.push(m[2]);
  }
  return out;
}

// A deliberately tiny DOM stub. This is not an attempt to emulate a browser --
// it only has to keep load-time statements from throwing so that the pure
// logic (sentence splitting, i18n, PDF layout analysis) becomes reachable.
// Anything genuinely DOM-dependent belongs in a browser-level check, not here.
function makeStubElement() {
  const el = {
    // enough of CSSStyleDeclaration for applyTheme() / applyFont()
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    value: '',
    textContent: '',
    innerHTML: '',
    appendChild(c) { el.children.push(c); return c; },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    getAttribute: () => null,
    focus() {},
    click() {},
    remove() {},
  };
  return el;
}

function makeContext() {
  const store = new Map();
  const documentStub = {
    getElementById: () => makeStubElement(),
    querySelector: () => makeStubElement(),
    querySelectorAll: () => [],
    createElement: () => makeStubElement(),
    addEventListener() {},
    body: makeStubElement(),
    documentElement: makeStubElement(),
  };

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: documentStub,
    navigator: { language: 'en-US' },
    // `length` + `key(i)` are part of the real Storage interface and the app
    // uses them to sweep every cache entry belonging to one document. Without
    // them here that sweep silently did nothing (it is wrapped in try/catch),
    // and a test asserting on it would pass against a no-op.
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
      clear: () => store.clear(),
      get length() { return store.size; },
      key: i => {
        const keys = [...store.keys()];
        return i >= 0 && i < keys.length ? keys[i] : null;
      },
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    fetch: () => Promise.reject(new Error('network disabled in tests')),
darkModeMediaQuery: null,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return vm.createContext(sandbox);
}

let cached = null;

// Returns { html, scripts, app } where `app` is the vm context holding every
// global the app defined. Cached so the (large) file is parsed once per run.
function loadApp() {
  if (cached) return cached;
  const html = readDist();
  const scripts = extractScripts(html);
  const ctx = makeContext();
  const loaded = [];
  const skipped = [];

  scripts.forEach((code, i) => {
    try {
      vm.runInContext(code, ctx, { filename: `dist-script-${i}.js` });
      loaded.push(i);
    } catch (err) {
      // A later script touching DOM we don't stub is expected and fine; the
      // earlier ones carry the logic under test. Record it so a test can
      // assert on how much actually loaded rather than silently passing
      // against an empty context.
      skipped.push({ index: i, message: err.message });
    }
  });

  // The app's own globals are mostly `const`, and a `const` declared by a vm
  // script lives in the context's global *lexical* scope rather than becoming
  // a property of the sandbox object -- so `ctx.I18N` is undefined even though
  // `I18N` is perfectly in scope inside the context. Evaluating the bare
  // identifier in that same context reaches it.
  function get(name) {
    try {
      return vm.runInContext(name, ctx, { filename: `probe-${name}.js` });
    } catch (err) {
      return undefined;
    }
  }

  cached = { html, scripts, app: ctx, get, loaded, skipped };
  return cached;
}

// The app kicks off an async init() on load which will reject against the stub
// DOM long after loadApp() has returned. That is expected here and must not
// take the test process down.
process.on('unhandledRejection', () => {});

module.exports = { loadApp, extractScripts, readDist, ROOT, DIST };
