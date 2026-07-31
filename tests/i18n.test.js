'use strict';

// i18n completeness and correctness.
//
// The bug that motivated most of this file: `t()` resolved translations with
// `dict[key] || I18N.zh[key] || key`, so any key whose translation is
// legitimately the empty string fell through to Chinese. 'toolbar.pagerSuffix'
// is '' in en/de/fr/es/it/ru (those languages put the whole label in the
// prefix), so the page counter rendered "第 3 / 12 页" in every UI language
// even though all nine dictionaries were complete and correct. Reviewing the
// translation tables could never have caught it; asserting on what `t()`
// actually returns does.

const { loadApp } = require('./lib/load.js');

module.exports = ({ describe, it, assert }) => {
  describe('i18n', () => {
    it('every language defines every key', () => {
      const { get } = loadApp();
      const I18N = get('I18N');
      const langs = Object.keys(I18N);
      assert.atLeast(langs.length, 9, 'UI language count');
      const baseKeys = Object.keys(I18N.zh);
      const problems = [];
      for (const lang of langs) {
        for (const key of baseKeys) {
          if (!Object.prototype.hasOwnProperty.call(I18N[lang], key)) {
            problems.push(`${lang} is missing ${key}`);
          }
        }
        for (const key of Object.keys(I18N[lang])) {
          if (!Object.prototype.hasOwnProperty.call(I18N.zh, key)) {
            problems.push(`${lang} has extra key ${key}`);
          }
        }
      }
      assert.deepEqual(problems, [], 'i18n key coverage');
    });

    it('keeps {placeholder} sets consistent across languages', () => {
      const { get } = loadApp();
      const I18N = get('I18N');
      const vars = s => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
      const problems = [];
      for (const key of Object.keys(I18N.zh)) {
        const expected = vars(I18N.zh[key]);
        for (const lang of Object.keys(I18N)) {
          const actual = vars(I18N[lang][key]);
          if (actual !== expected) {
            problems.push(`${key}: zh has [${expected}] but ${lang} has [${actual}]`);
          }
        }
      }
      assert.deepEqual(problems, [], 'placeholder mismatches');
    });

    it('t() returns an empty translation instead of falling back to Chinese', () => {
      // Regression guard for the pager-suffix bug described above.
      const { get, app } = loadApp();
      const I18N = get('I18N');
      const t = get('t');
      const settings = get('settings');

      const emptyInSomeLang = [];
      for (const lang of Object.keys(I18N)) {
        for (const key of Object.keys(I18N[lang])) {
          if (I18N[lang][key] === '') emptyInSomeLang.push([lang, key]);
        }
      }
      assert.atLeast(emptyInSomeLang.length, 1, 'expected at least one intentionally-empty translation to guard');

      const original = settings.uiLang;
      try {
        for (const [lang, key] of emptyInSomeLang) {
          settings.uiLang = lang;
          assert.equal(t(key), '', `t('${key}') under uiLang=${lang}`);
        }
      } finally {
        settings.uiLang = original;
      }
    });

    it('renders the pager label in the selected UI language', () => {
      const { get } = loadApp();
      const I18N = get('I18N');
      const t = get('t');
      const settings = get('settings');
      const original = settings.uiLang;
      try {
        const seen = new Set();
        for (const lang of Object.keys(I18N)) {
          settings.uiLang = lang;
          const label = t('toolbar.pagerPrefix') + '3 / 12' + t('toolbar.pagerSuffix');
          // no non-CJK-UI language should be showing the Chinese 页/頁
          if (!['zh', 'zh-hant', 'ja'].includes(lang)) {
            assert.notIncludes(label, '页', `${lang} pager label leaked Chinese`);
            assert.notIncludes(label, '頁', `${lang} pager label leaked Chinese`);
          }
          seen.add(label);
        }
        assert.atLeast(seen.size, 5, 'distinct pager labels across languages');
      } finally {
        settings.uiLang = original;
      }
    });

    it('has no untranslated hardcoded UI text in the markup', () => {
      // The i18n key-coverage test above cannot catch an element that simply
      // has no data-i18n attribute at all -- the dictionaries look complete
      // while the UI still shows Chinese to a German user. That is how the
      // sentence-language chips ("德语", "英语", ...) stayed untranslated in
      // every one of the nine UI languages.
      //
      // Language names are the deliberate exception: a language picker should
      // list endonyms (Deutsch, Français, 日本語), which are the same in every
      // UI language and correctly have no data-i18n key.
      const { html } = loadApp();
      const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

      const ENDONYMS = new Set(['简体中文', '繁體中文', '日本語', '한국어']);
      const offenders = [];
      const elementRe = /<([a-z]+)([^>]*)>([^<>]*[一-鿿][^<>]*)<\/\1>/g;
      for (const m of markup.matchAll(elementRe)) {
        const [, tag, attrs, text] = m;
        if (/data-i18n/.test(attrs)) continue;
        const t = text.trim();
        if (ENDONYMS.has(t)) continue;
        offenders.push(`<${tag}> ${t}`);
      }
      for (const m of markup.matchAll(/<[^>]*placeholder="([^"]*[一-鿿][^"]*)"[^>]*>/g)) {
        if (/data-i18n-placeholder/.test(m[0])) continue;
        offenders.push(`placeholder="${m[1]}"`);
      }
      assert.deepEqual(offenders, [], 'hardcoded Chinese UI strings with no data-i18n');
    });

    it('only tells the reader to click buttons that exist', () => {
      // Both of these used to name an "Apply text" button, in all nine
      // languages, months after that button had been split into "save as new
      // document" / "save to current document". Nothing catches a stale
      // instruction like this except reading it in the UI -- so pin it: any
      // string whose job is to point at a button must quote that button's
      // actual label in the same language.
      const { get } = loadApp();
      const I18N = get('I18N');
      for (const lang of Object.keys(I18N)) {
        const label = I18N[lang]['settings.applyTextNew'];
        assert.ok(label, `${lang} has settings.applyTextNew`);
        for (const key of ['import.extracted', 'settings.pasteDesc']) {
          assert.includes(I18N[lang][key], label, `${lang} ${key} does not name the "save as new document" button`);
        }
      }
    });

    it('lists languages in the same order everywhere', () => {
      // Three language pickers sit on one settings screen -- UI language,
      // sentence-splitting rules, analysis output language. They used to be in
      // three different orders (each roughly the order things were added in),
      // so the same set of languages read differently depending on which list
      // you were looking at. The shared rule is BCP-47 code order, with the
      // non-language escape hatches ("generic", "custom") pinned to the end.
      const { html, get } = loadApp();
      const sorted = (codes) => [...codes].sort();

      const uiLangs = get('UI_LANGS');
      assert.deepEqual(uiLangs, sorted(uiLangs), 'UI_LANGS is not in code order');
      assert.deepEqual(Object.keys(get('UI_LANG_NAMES')), uiLangs, 'UI_LANG_NAMES drifted from UI_LANGS');

      const outLangs = Object.keys(get('OUTPUT_LANG_NAMES'));
      assert.deepEqual(outLangs, sorted(outLangs), 'OUTPUT_LANG_NAMES is not in code order');
      assert.deepEqual(Object.keys(get('OUTPUT_LANG_TERMS')), outLangs, 'OUTPUT_LANG_TERMS drifted from OUTPUT_LANG_NAMES');

      const chipCodes = (containerId, attr) => {
        const block = html.split(`id="${containerId}"`)[1].split('</div>\n          </div>')[0];
        return [...block.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].map(m => m[1]);
      };

      const ruleChips = chipCodes('lang-rule-chips', 'data-lang');
      assert.equal(ruleChips[ruleChips.length - 1], 'generic', 'the catch-all rule belongs last');
      const realRules = ruleChips.slice(0, -1);
      assert.deepEqual(realRules, sorted(realRules), 'sentence-rule chips are not in code order');

      const outChips = chipCodes('output-lang-chips', 'data-outlang');
      assert.equal(outChips[outChips.length - 1], 'custom', '"custom…" belongs last');
      const realOut = outChips.slice(0, -1);
      assert.deepEqual(realOut, sorted(realOut), 'output-language chips are not in code order');
      assert.deepEqual(realOut, outLangs, 'the chips and OUTPUT_LANG_NAMES disagree about which languages exist');
    });

    it('does not name a provider in the loading message', () => {
      // The loading text must not vary by provider: an "OpenAI-format" key
      // very often points at a third-party or self-hosted service running a
      // completely different model, so naming OpenAI there is misleading.
      const { get } = loadApp();
      const I18N = get('I18N');
      for (const lang of Object.keys(I18N)) {
        const msg = I18N[lang]['panel.loading'];
        assert.ok(msg, `${lang} has panel.loading`);
        assert.notIncludes(msg, '{provider}', `${lang} panel.loading still interpolates a provider`);
        for (const name of ['OpenAI', 'Anthropic', 'Gemini', 'Claude']) {
          assert.notIncludes(msg, name, `${lang} panel.loading names ${name}`);
        }
      }
    });
  });
};
