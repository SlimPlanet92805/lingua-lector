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

    // Observed failure: for "Erdbeben" a model produced
    //   名词（中性，der/das，...）。动词/派生词不适用。
    // Two separate prompt defects, both fixed and pinned here.
    //
    // 1. The prompt used to illustrate German gender as the bare string
    //    "der/die/das". Read as a *format* rather than a menu, that invites a
    //    slash-separated answer -- which then contradicts the gender the model
    //    just stated. The instruction must demand exactly one article.
    it('tells the model to pick one article rather than list them', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.ok(/三选一|只写这个词实际的那一个定冠词/.test(prompt),
        'prompt must require choosing a single definite article');
      // The worked example is what makes it concrete for a weak model.
      assert.includes(prompt, 'der/das', 'prompt should name the wrong form it is ruling out');
      assert.ok(/Erdbeben[^。]*中性[^。]*只写 das/.test(prompt),
        'prompt should carry a worked example of the single-article rule');
    });

    // 2. "不适用的项跳过" was buried in a parenthetical and said nothing about
    //    *announcing* the skip, so the model dutifully wrote "动词/派生词不适用".
    it('forbids placeholder text for inapplicable word classes', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.ok(/整条略去/.test(prompt), 'prompt must say to omit the whole item');
      assert.ok(/不适用/.test(prompt) && /N\/A/.test(prompt),
        'prompt must name the placeholder wordings it is banning');
    });

    // Observed on Gemini 3.5 Flash Lite, the weakest model this tool is
    // routinely pointed at. Two failures in one bullet:
    //   - 定语从句 + 引导词 *welches* + 修饰主句中的地点名词 *Paraguay*
    //     the template's own placeholder wording, plus-signs and all, copied
    //     out as if it were the answer -- and no quote of the clause itself, so
    //     the reader cannot tell which half of the sentence is meant.
    //   - an extended participial attribute (*ihnen plötzlich gegebenen*)
    //     called a relative clause "with the relative pronoun omitted".
    it('requires the clause itself to be quoted, not just classified', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.ok(/逐字照抄/.test(prompt), 'prompt must demand a verbatim quote of the clause');
      assert.ok(/不要只写引导词/.test(prompt),
        'prompt must rule out naming only the introducing word');
    });

    it('bans copying the template placeholders as the answer', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.ok(/禁止把上面模板里的示意文字当成答案照抄/.test(prompt),
        'prompt must forbid echoing the template wording');
      assert.includes(prompt, '定语从句 + 引导词 + 修饰主句中的成分',
        'prompt should name the exact bad output shape it is ruling out');
    });

    // "定语从句" is the English-grammar label (attributive clause) applied
    // wholesale to every language. German grammar calls it a Relativsatz, and
    // the label is wrong outright for a free relative clause standing as the
    // subject. The prompt asks for the analysed language's own terminology and
    // keeps the syntactic function as a separate statement.
    it('asks for the analysed language own clause terminology', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.includes(prompt, '关系从句', 'prompt must use the relative-clause term');
      assert.ok(/「定语从句」是英语语法的叫法/.test(prompt),
        'prompt must say why the blanket English label is rejected');
      assert.ok(/Relativsatz/.test(prompt), 'prompt should name the German term');
    });

    // Latin is in the sentence-splitting language list but had no
    // language-specific terminology in the prompt: a model left to guess would
    // reach for the nearest English/German label ("temporal clause") for
    // constructs that have no finite verb at all, exactly the mistake rule 3
    // already guards against for German's extended participial attribute.
    it('names Latin non-finite constructions instead of calling them clauses', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.ok(/独立夺格/.test(prompt), 'prompt must name the ablative absolute');
      assert.ok(/ablativus absolutus/.test(prompt), 'prompt should give the Latin term');
      assert.ok(/accusativus cum infinitivo|AcI/.test(prompt),
        'prompt must name the accusative-and-infinitive (indirect statement) construction');
      assert.ok(/gerundium/.test(prompt) && /gerundivum/.test(prompt),
        'prompt must name gerund and gerundive');
    });

    // Observed inconsistency: for a source clause using the separated
    // preterite of a separable verb, the model sometimes gave back the
    // inflected surface string and sometimes correctly reassembled the
    // dictionary form -- nothing in the prompt actually said which one was
    // wanted, so "原词" ("the original word") was read either way.
    it('requires the vocab headword to be the dictionary form, not the inflected one', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.ok(/词典引用形式|词典原形/.test(prompt), 'prompt must call for the dictionary/citation form');
      assert.ok(/不是它在原句里出现的屈折/.test(prompt),
        'prompt must explicitly rule out the inflected surface form');
      assert.ok(/nahmen … aus/.test(prompt) && /ausnehmen/.test(prompt),
        'prompt should carry a worked example of reassembling a separable verb');
    });

    // Found by running the prompt over real Latin (Caesar, De Bello Gallico):
    // "動詞寫不定式" is the German/English dictionary convention, and Latin
    // dictionaries head verbs with the 1sg present instead. Told to produce an
    // infinitive for `contulerunt`, the model produced neither -- it emitted
    // *infero* while printing the correct principal parts of *confero* in the
    // same entry, and turned the ablative `phalange` into the non-word
    // *phalang*.
    it('ties the headword convention to the language being analysed', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.ok(/词典惯例/.test(prompt), 'prompt must defer to the language\'s own citation convention');
      assert.ok(/第一人称单数现在时/.test(prompt) && /不是不定式/.test(prompt),
        'prompt must give the Latin verb convention explicitly');
      assert.ok(/phalanx/.test(prompt) && /phalang\b/.test(prompt),
        'prompt should carry the observed truncated-stem counterexample');
      assert.ok(/同一个词/.test(prompt),
        'prompt must require the headword and its listed forms to be the same word');
    });

    it('defines a subordinate clause by its finite verb', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.ok(/定式动词/.test(prompt), 'prompt must state the finite-verb criterion');
      assert.ok(/分词定语/.test(prompt) && /不定式短语/.test(prompt),
        'prompt must name the structures that are not clauses');
      // Verb mood is a property of the predicate, not a clause type -- the
      // model had been answering "Konjunktiv II" where a type was asked for.
      assert.ok(/Konjunktiv/.test(prompt) && /不是从句的类型/.test(prompt),
        'prompt must separate verb mood from clause type');
    });

    // Reported from real reading: `wie man sie auch in Europa an
    // Staatsgebäuden sieht` came back as a relative clause introduced by the
    // "relative adverb wie" -- and the same sentence of the answer went on to
    // say that `sie` inside the clause refers to the antecedent, which is
    // precisely what proves it is not one.
    it('rules out wie-clauses and gives the resumptive-pronoun test', () => {
      const { get } = loadApp();
      const prompt = get('buildSystemPrompt')();
      assert.ok(/比较从句|Vergleichssatz/.test(prompt),
        'prompt must name the comparative clause as what a wie-clause is');
      assert.ok(/关系代词自己就是从句里的那个成分/.test(prompt),
        'prompt must explain why a relative pronoun leaves no resumptive pronoun');
      assert.ok(/复指代词/.test(prompt), 'prompt must state the resumptive-pronoun test');
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
