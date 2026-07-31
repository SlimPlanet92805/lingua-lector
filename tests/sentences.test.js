'use strict';

// Sentence splitter regression. Two layers:
//   1. a hand-curated multi-language corpus of edge cases (fixtures/sentences.json)
//   2. bulk sanity statistics over the whole embedded book, which is what
//      actually catches "the change looked fine on ten examples and shredded
//      four thousand real sentences"

const fs = require('fs');
const path = require('path');
const { loadApp } = require('./lib/load.js');

const fixtures = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'sentences.json'), 'utf8')
);

module.exports = ({ describe, it, assert }) => {
  describe('sentence splitting — edge cases', () => {
    for (const [lang, input, expected, note] of fixtures.cases) {
      it(`[${lang}] ${note}`, () => {
        const { get } = loadApp();
        const out = get('splitIntoSentences')(input, lang);
        assert.equal(out.length, expected, `${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
        // Character preservation is a property of SEGMENTS, not units: a unit's
        // text deliberately omits any footnote lifted out of it, so unit texts
        // do not reconstruct the paragraph. Segments do, exactly.
        const { segments } = get('splitIntoSentenceUnits')(input, lang);
        assert.equal(segments.map(s => s.text).join(''), input, 'segments must tile the paragraph exactly');
      });
    }
  });

  describe('sentence splitting — bulk corpus', () => {
    it('produces sane statistics across the whole embedded book', () => {
      const { get } = loadApp();
      const split = get('splitIntoSentences');
      const chapters = get('BOOK_CHAPTERS') || get('CHAPTERS') || get('DEFAULT_CHAPTERS');
      assert.ok(Array.isArray(chapters), 'embedded chapters available');

      const splitUnits = get('splitIntoSentenceUnits');
      let total = 0;
      let tiny = 0;
      let huge = 0;
      let lost = 0;
      let orphanStart = 0;

      for (const ch of chapters) {
        for (const para of ch.paragraphs || []) {
          const sentences = split(para, 'de');
          total += sentences.length;
          for (const s of sentences) {
            const meaningful = s.replace(/[^\p{L}\p{N}]/gu, '');
            if (meaningful.length < 3) tiny++;
            if (s.length > 1200) huge++;
            // a sentence starting with a comma or closing bracket is a break
            // placed mid-clause -- see the '!' trade-off in the fixtures
            if (/^[,;:)\]]/.test(s)) orphanStart++;
          }
          if (splitUnits(para, 'de').segments.map(s => s.text).join('') !== para) lost++;
        }
      }

      assert.atLeast(total, 5000, 'total sentences across the book');
      assert.equal(lost, 0, 'paragraphs whose segments did not tile the original text');
      // Thresholds are ceilings on known-good numbers, not exact values --
      // they catch a splitter change that shatters or fuses the corpus without
      // churning on every content edit.
      assert.atMost(tiny / total, 0.01, 'fraction of near-empty fragments');
      assert.atMost(huge / total, 0.01, 'fraction of runaway un-split sentences');
      // Now an invariant rather than a ratio: with the lowercase/comma guard on
      // '!' and '?' and inline glosses kept whole, no sentence in the corpus
      // begins mid-clause.
      assert.equal(orphanStart, 0, 'sentences starting mid-clause');
    });

    it('never returns an empty or whitespace-only sentence', () => {
      const { get } = loadApp();
      const split = get('splitIntoSentences');
      const chapters = get('BOOK_CHAPTERS') || get('CHAPTERS') || get('DEFAULT_CHAPTERS');
      let empties = 0;
      for (const ch of chapters) {
        for (const para of (ch.paragraphs || []).slice(0, 200)) {
          for (const s of split(para, 'de')) if (!s.trim()) empties++;
        }
      }
      assert.equal(empties, 0, 'empty sentences');
    });
  });
};
