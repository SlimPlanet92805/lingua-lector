'use strict';

// System-prompt and response-parsing contract.
//
// Weaker models (Gemini Flash Lite, small OpenAI-compatible models) ignore a
// prose instruction to "write the labels in the output language too" and fall
// back to the Chinese "译文：" that dominates their training data. The prompt
// therefore hands them the exact literals to copy, and the parser has a
// conservative rewrite as a backstop. Both halves are asserted here.

const { loadApp } = require('./lib/load.js');

module.exports = ({ describe, it, assert }) => {
  describe('output-language contract', () => {
    it('covers every selectable output language with literal terms', () => {
      const { get } = loadApp();
      const TERMS = get('OUTPUT_LANG_TERMS');
      const NAMES = get('OUTPUT_LANG_NAMES');
      const missing = Object.keys(NAMES).filter(k => !TERMS[k]);
      assert.deepEqual(missing, [], 'output languages with no literal term set');
      for (const [lang, t] of Object.entries(TERMS)) {
        for (const field of ['structure', 'vocab', 'translation']) {
          assert.ok(t[field] && t[field].trim(), `${lang}.${field} is empty`);
        }
      }
    });

    it('puts the literal headings and label into the prompt', () => {
      const { get } = loadApp();
      const build = get('buildSystemPrompt');
      const settings = get('settings');
      const TERMS = get('OUTPUT_LANG_TERMS');
      const original = settings.outputLang;
      try {
        for (const lang of Object.keys(TERMS)) {
          settings.outputLang = lang;
          const prompt = build();
          const t = TERMS[lang];
          assert.includes(prompt, `## ${t.structure}`, `${lang} structure heading`);
          assert.includes(prompt, `## ${t.vocab}`, `${lang} vocabulary heading`);
          const label = get('translationLabel')();
          // Full-width colon for CJK output, ASCII everywhere else: "Translation："
          // reads as a typo in English exactly as "译文:" does in Chinese.
          const expectedColon = ['zh', 'zh-hant', 'ja'].includes(lang) ? '：' : ':';
          assert.equal(label, `**${t.translation}${expectedColon}**`, `${lang} label punctuation`);
          assert.includes(prompt, label, `${lang} translation label`);
          // Each subordinate clause has to carry its own translation line, and
          // that instruction must hand over the same literal to copy -- a prose
          // "also translate the clause" is what weak models ignore. So the
          // label appears several times in the prompt, never just once.
          const labelCount = prompt.split(label).length - 1;
          assert.atLeast(labelCount, 3, `${lang} clause-level translation label template`);
          // A non-Chinese output language must not be shown the Chinese label
          // as the thing to copy — that is exactly what weak models latch onto.
          if (!['zh', 'zh-hant'].includes(lang)) {
            assert.notIncludes(prompt, '## 句子结构', `${lang} prompt still shows the Chinese heading as a target`);
          }
        }
      } finally {
        settings.outputLang = original;
      }
    });

    it('rewrites a wrong-language translation label', () => {
      const { get } = loadApp();
      const normalize = get('normalizeTranslationLabel');
      const settings = get('settings');
      const original = settings.outputLang;
      try {
        settings.outputLang = 'en';
        const out = normalize('**译文：** The sentence means this.');
        assert.includes(out, '**Translation:**', 'label rewritten to the requested language');
        assert.notIncludes(out, '译文', 'Chinese label removed');
        assert.includes(out, 'The sentence means this.', 'body preserved');

        // unbolted / ASCII-colon variants
        assert.includes(normalize('译文: Something'), 'Translation');
        // already correct -> untouched
        assert.equal(normalize('**Translation:** Fine'), '**Translation:** Fine');
      } finally {
        settings.outputLang = original;
      }
    });

    it('rewrites the per-clause labels too, not only the first one', () => {
      // Since the prompt asks for a translation line under every clause, a
      // model that fell back to Chinese emits the wrong label several times.
      const { get } = loadApp();
      const normalize = get('normalizeTranslationLabel');
      const settings = get('settings');
      const original = settings.outputLang;
      try {
        settings.outputLang = 'en';
        const out = normalize([
          '**译文：** The whole sentence.',
          '- relative clause, modifies *Kaiser*',
          '  **译文：** who had just arrived',
          '- 译文: bare bullet form',
        ].join('\n'));
        assert.equal(out.split('**Translation:**').length - 1, 3, 'every label rewritten');
        assert.notIncludes(out, '译文', 'no Chinese label left behind');
        assert.includes(out, '- **Translation:** bare bullet form', 'list marker preserved');
      } finally {
        settings.outputLang = original;
      }
    });

    it('keeps a clause translation inside its bullet', () => {
      // The clause translation arrives as an indented continuation line; if
      // the renderer closed the list there, it became a stray paragraph and
      // every following bullet started a new <ul>.
      const { get } = loadApp();
      const md = get('mdToHtml');
      const html = md('- relative clause, modifies *Kaiser*\n  **Translation:** who had just arrived\n- second clause');
      assert.equal(html.split('<ul>').length - 1, 1, 'single list');
      assert.includes(html, 'who had just arrived</li>', 'continuation stayed in the <li>');
    });

    it('leaves model prose alone', () => {
      const { get } = loadApp();
      const normalize = get('normalizeTranslationLabel');
      const settings = get('settings');
      const original = settings.outputLang;
      try {
        settings.outputLang = 'en';
        // "译文" appearing mid-sentence rather than as a leading label
        const prose = 'The word 译文 is discussed here: it means translation.';
        assert.equal(normalize(prose), prose, 'mid-sentence mentions must not be rewritten');
      } finally {
        settings.outputLang = original;
      }
    });

    it('splits sections whatever language the model used for the headings', () => {
      const { get } = loadApp();
      const split = get('splitAnalysisSections');
      const settings = get('settings');
      const original = settings.outputLang;
      try {
        settings.outputLang = 'en';
        const asked = split('## Sentence structure\nAAA\n\n## Vocabulary\nBBB');
        assert.includes(asked.grammarMd, 'AAA');
        assert.includes(asked.vocabMd, 'BBB');

        // model ignored the requested language and emitted Chinese headings
        const other = split('## 句子结构\nCCC\n\n## 难词与短语\nDDD');
        assert.includes(other.grammarMd, 'CCC');
        assert.includes(other.vocabMd, 'DDD');

        // model invented its own headings entirely — positional fallback
        const odd = split('## Analyse\nEEE\n\n## Woerter\nFFF');
        assert.includes(odd.grammarMd, 'EEE');
        assert.includes(odd.vocabMd, 'FFF');
      } finally {
        settings.outputLang = original;
      }
    });
  });

  describe('provider defaults', () => {
    it('has a key/model/baseUrl shape for each provider', () => {
      const { get } = loadApp();
      const D = get('PROVIDER_DEFAULTS');
      for (const name of ['anthropic', 'openai', 'gemini']) {
        assert.ok(D[name], `${name} defaults exist`);
        assert.ok(typeof D[name].model === 'string' && D[name].model, `${name} has a default model`);
      }
    });

    it('offers the default model in the settings suggestion list', () => {
      const { html, get } = loadApp();
      const D = get('PROVIDER_DEFAULTS');
      for (const name of ['anthropic', 'openai', 'gemini']) {
        assert.includes(html, `<option value="${D[name].model}">`,
          `${name} default model "${D[name].model}" is missing from its datalist`);
      }
    });
  });
};
