'use strict';

// Accessibility checks.
//
// The project had none of this: `tabindex`, `role=` and `aria-*` appeared zero
// times in the whole source, and `<html lang>` was hardcoded to "zh" so a
// screen reader applied Chinese pronunciation to German text. On a tool whose
// entire purpose is reading foreign-language prose, language marking is the
// single highest-value thing here — which is why it gets the most coverage.

const { loadApp } = require('./lib/load.js');

// --- WCAG contrast, computed rather than eyeballed -------------------------
// sRGB relative luminance per WCAG 2.1.
function luminance([r, g, b]) {
  const lin = [r, g, b]
    .map(v => v / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrastRatio(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

function parseColor(value) {
  const v = String(value).trim();
  let m = v.match(/^#([0-9a-f]{3})$/i);
  if (m) return m[1].split('').map(c => parseInt(c + c, 16));
  m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = v.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

// Pull `--name: value;` pairs out of a CSS rule body.
function varsInBlock(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// Resolve one level of var() indirection against a scope.
function resolve(value, scope) {
  let v = value;
  for (let i = 0; i < 5 && /var\(/.test(v); i++) {
    v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (_, name) => scope[name] || '');
  }
  return v.trim();
}

module.exports = ({ describe, it, assert }) => {
  describe('accessibility — language marking', () => {
    it('sets the document language from the UI language, not a hardcoded value', () => {
      const { html, get, app } = loadApp();
      // no hardcoded lang other than the initial server-rendered default
      const applyI18n = get('applyI18n');
      const settings = get('settings');
      const original = settings.uiLang;
      const seen = {};
      try {
        for (const lang of ['en', 'de', 'ru', 'ja', 'zh', 'zh-hant']) {
          settings.uiLang = lang;
          applyI18n();
          seen[lang] = app.document.documentElement.lang;
        }
      } finally {
        settings.uiLang = original;
        applyI18n();
      }
      assert.equal(seen.en, 'en', 'English');
      assert.equal(seen.de, 'de', 'German');
      assert.equal(seen.ru, 'ru', 'Russian');
      assert.equal(seen.ja, 'ja', 'Japanese');
      // zh needs a script subtag to be meaningful to a speech engine
      assert.equal(seen.zh, 'zh-Hans', 'Simplified Chinese');
      assert.equal(seen['zh-hant'], 'zh-Hant', 'Traditional Chinese');
      assert.ok(html.includes('<html lang='), 'document still ships with a lang attribute');
    });

    it('marks sentence spans with the language of the text, not the UI', () => {
      // Asserted on the source rather than a live DOM: appendSentenceSpan is
      // what stamps it, and it must read settings.sentenceLang (the language
      // of the book) rather than the interface language.
      const { html } = loadApp();
      assert.includes(html, 'span.lang = settings.sentenceLang',
        'sentence spans must carry the source text language');
    });
  });

  describe('accessibility — keyboard and semantics', () => {
    it('makes sentences reachable and operable from the keyboard', () => {
      const { html } = loadApp();
      assert.includes(html, "span.setAttribute('role', 'button')", 'sentences expose a button role');
      assert.includes(html, 'span.tabIndex = 0', 'sentences are focus stops');
      assert.includes(html, "e.key !== 'Enter' && e.key !== ' '", 'Enter/Space activate a sentence');
      assert.includes(html, '.sent:focus-visible', 'focused sentence is visibly indicated');
    });

    it('announces analysis results and dialog semantics', () => {
      const { html } = loadApp();
      assert.includes(html, 'aria-live="polite"', 'analysis panel is a live region');
      assert.includes(html, 'aria-busy', 'panel reports when it is mid-update');
      assert.includes(html, 'role="dialog"', 'settings is a dialog');
      assert.includes(html, 'aria-modal="true"', 'settings dialog is modal');
      assert.includes(html, 'aria-labelledby="settings-title"', 'dialog has an accessible name');
    });

    it('traps focus inside the settings dialog and restores it on close', () => {
      const { html } = loadApp();
      assert.includes(html, 'function wireSettingsFocusTrap', 'focus trap exists');
      assert.includes(html, 'settingsReturnFocus', 'focus is returned to the opener');
    });

    it('gives icon-only controls an accessible name', () => {
      const { html } = loadApp();
      const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      const offenders = [];
      for (const m of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const [, attrs, inner] = m;
        const text = inner.replace(/<[^>]*>/g, '').trim();
        const hasName =
          /aria-label|data-i18n-label|data-i18n(?!-)/.test(attrs) ||
          /[\p{L}\p{N}]/u.test(text);
        if (!hasName) offenders.push(text || attrs.trim().slice(0, 40));
      }
      assert.deepEqual(offenders, [], 'buttons with no accessible name');
    });

    it('honours prefers-reduced-motion', () => {
      const { html } = loadApp();
      assert.includes(html, 'prefers-reduced-motion', 'reduced-motion preference respected');
    });
  });

  describe('accessibility — colour contrast', () => {
    it('meets WCAG AA for body text in every theme', () => {
      const { html } = loadApp();
      const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];

      // :root holds the light theme; each [data-theme="..."] block overrides it.
      const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
      assert.ok(rootMatch, ':root variables found');
      const base = varsInBlock(rootMatch[1]);

      const themes = { light: base };
      for (const m of css.matchAll(/\[data-theme=["']([\w-]+)["']\]\s*\{([\s\S]*?)\}/g)) {
        themes[m[1]] = Object.assign({}, base, varsInBlock(m[2]));
      }
      assert.atLeast(Object.keys(themes).length, 3, 'light + dark + sepia themes present');

      const failures = [];
      for (const [name, scope] of Object.entries(themes)) {
        const fg = parseColor(resolve(scope['--ink'] || '', scope));
        const bg = parseColor(resolve(scope['--paper'] || '', scope));
        if (!fg || !bg) {
          failures.push(`${name}: could not resolve --ink/--paper`);
          continue;
        }
        const ratio = contrastRatio(fg, bg);
        if (ratio < 4.5) failures.push(`${name}: body text contrast ${ratio.toFixed(2)}:1 (needs 4.5:1)`);
      }
      assert.deepEqual(failures, [], 'WCAG AA body-text contrast');
    });
  });
};
