'use strict';

// Property-based tests for the sentence splitter.
//
// Testing every language against real books is not affordable, and the
// hand-written fixtures only prove the splitter handles the cases somebody
// already thought of. These assert INVARIANTS that must hold for *every*
// input, then throw a few thousand adversarial inputs at them: nested and
// unbalanced brackets, runs of terminal punctuation, every quote style, mixed
// scripts, abbreviations, ordinals, lone whitespace, and text with no
// punctuation at all.
//
// It is deliberately self-contained and cheap to run: a fixed seed, its own
// tiny PRNG, no dependencies, no network, and it finishes in well under a
// second. A failure prints the seed and the exact input so the single case can
// be replayed without re-running the sweep.

const { loadApp } = require('./lib/load.js');

// mulberry32 — small, fast, fully deterministic from a 32-bit seed.
function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  // words and word-like things
  'Wort', 'Satz', 'der', 'und', 'Meyer', 'Straße', 'naïve', 'Ünïcode', 'x',
  'word', 'the', 'Smith', 'ĉiu', 'Ćwik', 'Ålesund',
  // abbreviations and initials -- the splitter's main source of ambiguity
  'Dr.', 'z.B.', 'vgl.', 'Prof.', 'S.', 'T.', 'stellvertr.', 'usw.',
  // numbers and ordinals
  '1', '42', '1886', '15.', '3.', '9.',
  // terminal punctuation, singly and in runs
  '.', '!', '?', '...', '…', '?!', '!!', '.".',
  // clause punctuation
  ',', ';', ':', '—', '-', '(', ')',
  // every quote style the corpus uses
  '»', '«', '“', '”', '„', '‹', '›', '‘', '’', '"', "'",
  // brackets, including deliberately unbalanced ones
  '[', ']', '[Fußnote:', '[gloss]', '[a. b.]',
  // whitespace
  ' ', '  ', ' ',
];

const LANGS = ['de', 'en', 'fr', 'es', 'it', 'pt', 'nl', 'la', 'cs', 'pl', 'tr', 'generic'];

function makeInput(next) {
  const n = 1 + Math.floor(next() * 24);
  let s = '';
  for (let i = 0; i < n; i++) s += TOKENS[Math.floor(next() * TOKENS.length)];
  return s;
}

module.exports = ({ describe, it, assert }) => {
  describe('splitter properties (generated inputs)', () => {
    const SEED = 0x5EED1234; // fixed: a failure here is reproducible, not flaky
    const CASES = 2000;

    // Every property is checked on every generated case in a single pass, so
    // the whole sweep costs one split per input rather than one per property.
    it(`holds every invariant across ${CASES} generated inputs`, () => {
      const { get } = loadApp();
      const splitUnits = get('splitIntoSentenceUnits');
      const next = rng(SEED);
      const failures = [];

      const fail = (i, input, why) => {
        if (failures.length < 5) {
          failures.push(`case ${i} (seed ${SEED}) ${JSON.stringify(input)}\n      ${why}`);
        }
      };

      for (let i = 0; i < CASES; i++) {
        const input = makeInput(next);
        const lang = LANGS[Math.floor(next() * LANGS.length)];

        let out;
        const started = Date.now();
        try {
          out = splitUnits(input, lang);
        } catch (err) {
          fail(i, input, `threw: ${err.message}`);
          continue;
        }
        // Termination: the scanner advances an index in a while-loop, so a
        // missed increment would hang rather than fail. Bound it.
        if (Date.now() - started > 250) fail(i, input, 'took over 250ms — possible non-termination');

        const { units, segments } = out;

        // A paragraph with nothing but whitespace has no sentence to own that
        // whitespace, so it correctly produces nothing at all. Every other
        // input must tile.
        if (!input.trim()) {
          if (units.length || segments.length) fail(i, input, 'whitespace-only input produced units');
          continue;
        }

        // 1. Segments tile the input exactly: nothing lost, nothing invented.
        const tiled = segments.map(s => s.text).join('');
        if (tiled !== input) fail(i, input, `segments do not tile: got ${JSON.stringify(tiled)}`);

        // 2. No unit or segment is empty or pure whitespace.
        if (units.some(u => !u.text.trim())) fail(i, input, 'a unit has no analysable text');
        if (segments.some(s => !s.text.trim())) fail(i, input, 'a segment is whitespace-only');

        // 3. Every segment points at a unit that exists.
        const uids = new Set(units.map(u => u.uid));
        if (segments.some(s => !uids.has(s.uid))) fail(i, input, 'segment references a missing unit');

        // 4. Every unit is rendered somewhere.
        const used = new Set(segments.map(s => s.uid));
        if (units.some(u => !used.has(u.uid))) fail(i, input, 'a unit has no segments');

        // 5. Bracket characters are conserved (they are structural, and the
        //    footnote logic moves text around them).
        const count = (str, ch) => str.split(ch).length - 1;
        if (count(tiled, '[') !== count(input, '[') || count(tiled, ']') !== count(input, ']')) {
          fail(i, input, 'bracket characters were added or dropped');
        }

        // 6. Determinism: the same input must always give the same answer.
        const again = splitUnits(input, lang);
        if (JSON.stringify(again.units) !== JSON.stringify(units)
          || JSON.stringify(again.segments) !== JSON.stringify(segments)) {
          fail(i, input, 'not deterministic');
        }

        // 7. Segments are in reading order and do not overlap.
        let seenTo = 0;
        for (const s of segments) {
          if (typeof s.start !== 'number') break; // start/end are optional on the public shape
          if (s.start < seenTo) { fail(i, input, 'segments overlap or are out of order'); break; }
          seenTo = s.end;
        }
      }

      assert.deepEqual(failures, [], `property violations (showing up to 5)`);
    });

    it('loses no text when a unit is split again', () => {
      // Note this is character conservation, NOT idempotence. Re-splitting a
      // sentence can legitimately yield more than one unit, because two of the
      // splitter's rules are context-sensitive by design: the tiny-fragment
      // merge looks at the preceding sentence, and the ellipsis/terminal rules
      // look at the following character. "-... Wort." stays whole inside a
      // longer paragraph and splits in two on its own, and that is correct
      // behaviour rather than a bug. What must never happen is text going
      // missing on the second pass.
      const { get } = loadApp();
      const splitUnits = get('splitIntoSentenceUnits');
      const next = rng(0xA11CE);
      const failures = [];
      const strip = s => s.replace(/\s+/g, '');

      for (let i = 0; i < 500 && failures.length < 5; i++) {
        const input = makeInput(next);
        for (const u of splitUnits(input, 'de').units) {
          if (u.kind !== 'main' || /[[\]]/.test(u.text)) continue;
          const again = splitUnits(u.text, 'de');
          if (strip(again.segments.map(s => s.text).join('')) !== strip(u.text)) {
            failures.push(`${JSON.stringify(u.text)} lost text on re-split: ${JSON.stringify(again.segments.map(s => s.text))}`);
            break;
          }
        }
      }
      assert.deepEqual(failures, [], 'text lost when re-splitting a unit');
    });

    it('never loses text on the real English corpus', () => {
      // Cheap counterweight to the German-only bulk fixture: the same
      // invariants over English prose extracted from the bundled papers.
      const fs = require('fs');
      const path = require('path');
      const file = path.join(__dirname, 'fixtures', 'corpus-en.txt');
      if (!fs.existsSync(file)) {
        assert.ok(true, 'corpus-en.txt not generated; skipping');
        return;
      }
      const { get } = loadApp();
      const splitUnits = get('splitIntoSentenceUnits');
      const paras = fs.readFileSync(file, 'utf8')
        .split(/(?:\r?\n){2,}/)          // the fixture is written on Windows, so CRLF
        .map(p => p.trim())
        .filter(p => p && !p.startsWith('#')); // drop the provenance header
      assert.atLeast(paras.length, 100, 'English corpus paragraph count');

      let total = 0;
      let orphan = 0;
      const broken = [];
      for (const para of paras) {
        const { units, segments } = splitUnits(para, 'en');
        if (segments.map(s => s.text).join('') !== para && broken.length < 3) broken.push(para.slice(0, 80));
        total += units.length;
        for (const u of units) if (/^[,;:)\]]/.test(u.text)) orphan++;
      }
      assert.deepEqual(broken, [], 'English paragraphs whose segments did not tile');
      assert.atLeast(total, 500, 'English sentences');
      assert.atMost(orphan / total, 0.01, 'fraction of English sentences starting mid-clause');
    });
  });
};
