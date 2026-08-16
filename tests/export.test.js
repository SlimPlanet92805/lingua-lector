'use strict';

// Vocabulary CSV export.
//
// The AI's vocab bullets are free-form prose after the word (format varies by
// part of speech and by output language, with no second delimiter), so this
// deliberately does not try to split that prose into separate pos/gender
// columns -- only the word/definition split the prompt's own template already
// gives us for free (the em dash) is trusted. parseVocabBullets is the one
// genuinely fragile piece here (regex against model-authored text), so it
// gets the most direct coverage.

const { loadApp } = require('./lib/load.js');

module.exports = ({ describe, it, assert }) => {
  function freshStorage(app) {
    app.localStorage.clear();
  }

  describe('CSV field escaping', () => {
    it('quotes fields containing a comma, quote, or newline', () => {
      const { get } = loadApp();
      const toCsvField = get('toCsvField');
      assert.equal(toCsvField('a,b'), '"a,b"');
      assert.equal(toCsvField('say "hi"'), '"say ""hi"""');
      assert.equal(toCsvField('line1\nline2'), '"line1\nline2"');
      assert.equal(toCsvField('line1\r\nline2'), '"line1\r\nline2"');
    });

    it('leaves a plain value unquoted', () => {
      const { get } = loadApp();
      assert.equal(get('toCsvField')('Erdbeben'), 'Erdbeben');
    });

    it('treats null and undefined as an empty field', () => {
      const { get } = loadApp();
      const toCsvField = get('toCsvField');
      assert.equal(toCsvField(null), '');
      assert.equal(toCsvField(undefined), '');
    });

    it('joins a row with commas and terminates it with CRLF', () => {
      const { get } = loadApp();
      assert.equal(get('toCsvRow')(['a', 'b,c', 'd']), 'a,"b,c",d\r\n');
    });
  });

  describe('vocab bullet parsing', () => {
    it('splits a noun entry on the single em dash', () => {
      const { get } = loadApp();
      const rows = get('parseVocabBullets')('- *Erdbeben* — 地震，中性，das Erdbeben，复数 die Erdbeben');
      assert.deepEqual(rows, [{ word: 'Erdbeben', notes: '地震，中性，das Erdbeben，复数 die Erdbeben' }]);
    });

    it('splits a verb entry with principal parts', () => {
      const { get } = loadApp();
      const rows = get('parseVocabBullets')(
        '- *sich befinden* — to be located; 3sg befindet sich, past befand sich, past participle hat sich befunden');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].word, 'sich befinden');
      assert.includes(rows[0].notes, 'past participle hat sich befunden');
    });

    it('strips nested markdown emphasis from both columns', () => {
      const { get } = loadApp();
      const rows = get('parseVocabBullets')('- *Kern* — **wichtig**: der `Kern`, plural die Kerne');
      assert.deepEqual(rows, [{ word: 'Kern', notes: 'wichtig: der Kern, plural die Kerne' }]);
    });

    it('returns nothing for prose with no bullets', () => {
      const { get } = loadApp();
      assert.deepEqual(get('parseVocabBullets')('这句话用词较为平易，没有特别生僻的词汇。'), []);
    });

    it('does not match a structure-section clause line (doubled em dash)', () => {
      // Regression guard: buildSystemPrompt()'s clause-bullet template uses a
      // doubled em dash ("——"), vocab bullets use a single one ("—"). Even
      // though callers only ever feed this the isolated vocabMd half, this
      // pins the distinguishing character so a future prompt tweak that
      // narrows the gap gets caught here first.
      const { get } = loadApp();
      const line = '- *ihnen plötzlich gegebenen* —— 分词定语（扩展定语），修饰主句中的 Staatsformen';
      assert.deepEqual(get('parseVocabBullets')(line), []);
    });

    it('folds an indented continuation line into the previous bullet', () => {
      const { get } = loadApp();
      const rows = get('parseVocabBullets')('- *Kern* — der Kern\n  , plural die Kerne');
      assert.equal(rows.length, 1);
      assert.includes(rows[0].notes, 'plural die Kerne');
    });
  });

  describe('CSV download', () => {
    // Regression guard for a bug reported from a real export: Excel opens a
    // double-clicked .csv by sniffing the system codepage, not UTF-8, unless
    // a BOM says otherwise. Without it every umlaut, em dash and CJK
    // character in the file -- i.e. most of what a vocab CSV actually
    // contains -- came out as mojibake. Can't drive this through an actual
    // Blob (the vm environment has none), so this pins it at the source
    // level: the Blob parts array must carry the BOM ahead of csvText, and
    // buildVocabCsv()'s own return value must stay BOM-free (it's a pure
    // string used elsewhere in tests without expecting one).
    it('prefixes the downloaded blob with a UTF-8 BOM', () => {
      const { html } = loadApp();
      assert.ok(/Blob\(\['﻿',\s*csvText\]/.test(html),
        'triggerCsvDownload must put the BOM ahead of csvText in the Blob parts');
    });

    it('buildVocabCsv itself stays BOM-free', () => {
      const { get } = loadApp();
      const csv = get('buildVocabCsv')([['Erdbeben', '地震', 'Ein Satz.', 'Kap. 1']]);
      assert.equal(csv.charCodeAt(0), 'W'.charCodeAt(0), 'starts with the header, no leading BOM');
    });
  });

  describe('collectVocabRows', () => {
    it('reads cached entries for a saved (non-open) document, skipping errors', async () => {
      const { get, app } = loadApp();
      freshStorage(app);

      const docId = 'doc-export-test';
      const chapterId = 'c0';
      const paraText = 'Das Erdbeben war schrecklich.';

      const { units } = get('splitIntoSentenceUnits')(paraText, 'de');
      assert.equal(units.length, 1, 'sanity: one sentence in, one unit out');
      const sentenceText = units[0].text;
      const goodKey = get('cacheKeyForChapter')(sentenceText, chapterId);
      const badKey = get('cacheKeyForChapter')('some other sentence.', chapterId);

      const fullText = '## Sentence structure\n**Translation:** It was terrible.\n\n' +
        '## Vocabulary\n- *Erdbeben* — earthquake, neuter, das Erdbeben, plural die Erdbeben';
      const cacheBlob = {
        [goodKey]: { history: [{ role: 'user', content: 'x' }, { role: 'assistant', content: fullText }] },
        [badKey]: { error: 'analysis failed' },
      };
      app.localStorage.setItem(get('cacheStorageKeyFor')(docId, chapterId), JSON.stringify(cacheBlob));
      app.localStorage.setItem(get('docStorageKey')(docId), JSON.stringify({
        bookTitle: 'Export Test Doc',
        chapters: [{ id: chapterId, title: 'Chapter One', dateRange: '', paragraphs: [paraText] }],
      }));

      const rows = await get('collectVocabRows')(docId);
      assert.deepEqual(rows, [
        ['Erdbeben', 'earthquake, neuter, das Erdbeben, plural die Erdbeben', sentenceText, 'Chapter One'],
      ]);
    });

    it('returns nothing for a document with no cache blob at all', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      app.localStorage.setItem(get('docStorageKey')('doc-empty'), JSON.stringify({
        bookTitle: 'Untouched',
        chapters: [{ id: 'c0', title: 'One', dateRange: '', paragraphs: ['Ein Satz.'] }],
      }));
      assert.deepEqual(await get('collectVocabRows')('doc-empty'), []);
    });

    it('serves the built-in book from the BOOK_CHAPTERS constant, never blob storage', async () => {
      // The common case: a reader who never opened the document-library UI has
      // no lingua-lector-doc-book:heyking blob, so loadDocumentContent() for it
      // would return null. documentContentForExport() must special-case this.
      const { get, app } = loadApp();
      freshStorage(app);
      const bookDocId = get('BOOK_DOC_ID');
      const content = await get('documentContentForExport')(bookDocId);
      assert.equal(content.chapters, get('BOOK_CHAPTERS'), 'same array, not a copy fetched from storage');
      assert.equal(content.bookTitle, get('BOOK_TITLE'));
    });
  });

  describe('cache key refactor', () => {
    it('cacheKeyFor and cacheKeyForChapter agree for the current chapter', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      await get('loadInitialDocument')();
      const chapterId = get('currentChapter')().id;
      const text = 'Ein Testsatz für den Cache-Schlüssel.';
      assert.equal(get('cacheKeyFor')(text), get('cacheKeyForChapter')(text, chapterId));
    });

    it('cacheStorageKey and cacheStorageKeyFor agree for the current document/chapter', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      await get('loadInitialDocument')();
      const chapterId = get('currentChapter')().id;
      assert.equal(get('cacheStorageKey')(), get('cacheStorageKeyFor')(get('currentDocId'), chapterId));
    });
  });
};
