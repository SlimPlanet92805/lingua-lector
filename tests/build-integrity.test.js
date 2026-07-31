'use strict';

// Checks that the distributed single file is actually well-formed and complete.
// These replace the ad-hoc greps that used to be re-typed by hand after every
// change: placeholder substitution, tag balance, JS syntax, and dangling
// getElementById references.

const vm = require('vm');
const { loadApp } = require('./lib/load.js');

module.exports = ({ describe, it, assert }) => {
  describe('build integrity', () => {
    it('substitutes every build placeholder', () => {
      const { html } = loadApp();
      const leftovers = html.match(/__[A-Z0-9_]+__/g) || [];
      assert.deepEqual([...new Set(leftovers)], [], 'unsubstituted placeholders remain');
    });

    it('embeds the book chapters', () => {
      const { get } = loadApp();
      const chapters = get('BOOK_CHAPTERS') || get('CHAPTERS') || get('DEFAULT_CHAPTERS');
      assert.ok(Array.isArray(chapters), 'expected an embedded chapters array');
      assert.atLeast(chapters.length, 2, 'chapter count');
      const total = chapters.reduce((n, c) => n + (c.paragraphs || []).length, 0);
      assert.atLeast(total, 100, 'total embedded paragraphs');
    });

    it('balances script and div tags', () => {
      const { html } = loadApp();
      // <script> itself is counted over the whole file; the rest are counted
      // over markup only. Script bodies mention tag names in comments and
      // strings ("chapter <select>", innerHTML templates), and counting those
      // as markup produces false mismatches.
      const scriptOpen = (html.match(/<script[\s>]/gi) || []).length;
      const scriptClose = (html.match(/<\/script>/gi) || []).length;
      assert.equal(scriptOpen, scriptClose, '<script> open/close mismatch');

      const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      for (const tag of ['div', 'select', 'datalist', 'ul', 'label']) {
        const open = (markup.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
        const close = (markup.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
        assert.equal(open, close, `<${tag}> open/close mismatch`);
      }
    });

    it('parses every inline script as valid JS', () => {
      const { scripts } = loadApp();
      assert.atLeast(scripts.length, 4, 'inline script count');
      scripts.forEach((code, i) => {
        // script 0 is the pdf.js ESM bootstrap; `new vm.Script` rejects
        // top-level `import`, so compile that one as a module instead.
        try {
          if (/^\s*import\s/m.test(code)) {
            new vm.SourceTextModule(code); // only if --experimental-vm-modules
          } else {
            new vm.Script(code, { filename: `inline-${i}.js` });
          }
        } catch (err) {
          if (/SourceTextModule/.test(err.message)) return; // flag not enabled; skip
          throw new Error(`inline script ${i} failed to parse: ${err.message}`);
        }
      });
    });

    it('has no dangling getElementById references', () => {
      const { html } = loadApp();
      const defined = new Set();
      for (const m of html.matchAll(/\bid="([^"]+)"/g)) defined.add(m[1]);
      const missing = [];
      for (const m of html.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
        if (!defined.has(m[1])) missing.push(m[1]);
      }
      assert.deepEqual([...new Set(missing)], [], 'getElementById targets with no matching id=');
    });

    it('references only element ids that exist for every data-i18n target', () => {
      const { html, get } = loadApp();
      const I18N = get('I18N');
      const zh = I18N.zh;
      const missing = [];
      for (const m of html.matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)) {
        if (!Object.prototype.hasOwnProperty.call(zh, m[1])) missing.push(m[1]);
      }
      assert.deepEqual([...new Set(missing)], [], 'data-i18n keys with no entry in the base dictionary');
    });
  });
};
