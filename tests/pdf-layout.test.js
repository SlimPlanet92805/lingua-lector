'use strict';

// PDF layout analysis regression.
//
// extractPdfLines() only needs an object exposing getTextContent() and
// getViewport(), so it can be driven with synthetic pages built from real
// measurements — no PDF parsing, no pdf.js, no fixtures binary. The numbers in
// the "numerals" case below are taken verbatim from
// "300 Jahre Regiment Hoch- und Deutschmeister.pdf" (PageMaker 6.52), which is
// where the bug was found.

const { loadApp } = require('./lib/load.js');

// pdf.js hands back items positioned by an affine transform; only tx/ty matter
// here. `height` is the glyph height, `width` the advance.
function item(str, x, y, { size = 9, width = null } = {}) {
  return {
    str,
    transform: [size, 0, 0, size, x, y],
    width: width === null ? str.length * size * 0.5 : width,
    height: size,
  };
}

function fakePage(items, { height = 709 } = {}) {
  return {
    getTextContent: async () => ({ items }),
    getViewport: () => ({ height }),
  };
}

module.exports = ({ describe, it, assert }) => {
  describe('PDF line assembly', () => {
    it('keeps differently-sized numerals on their own line', async () => {
      // Real geometry from p.154 of the Deutschmeister volume: the 9pt prose
      // sits on baseline 418.106 while the 8pt numerals sit on 418.387. The
      // old fixed 2pt bucketing (Math.round(y / 2) * 2) put those 0.28pt apart
      // values in DIFFERENT buckets, tearing every date out of its sentence.
      const extract = loadApp().get('extractPdfLines');
      const B = 418.106;
      const N = 418.387;
      const page = fakePage([
        item('Das Jahr ', 141.66, B),
        item('1996', 178.50, N, { size: 8, width: 16.2 }),
        item(' brachte den Wienern die ', 194.70, B),
        item('300', 299.34, N, { size: 8, width: 12.2 }),
        item('-Jahr-Feier', 311.58, B),
      ]);
      const lines = await extract(page);
      assert.equal(lines.length, 1, 'the numerals must not form separate lines');
      assert.includes(lines[0].text, '1996', 'year survived');
      assert.includes(lines[0].text, '300-Jahr-Feier', 'number stayed joined to its word');
      assert.equal(lines[0].text, 'Das Jahr 1996 brachte den Wienern die 300-Jahr-Feier');
    });

    it('reads a line left-to-right regardless of content-stream order', async () => {
      // Layout tools routinely emit a line's body text first and come back for
      // the differently-styled runs afterwards, so emission order is not
      // reading order.
      const extract = loadApp().get('extractPdfLines');
      const y = 400;
      const page = fakePage([
        item('Das Jahr ', 100, y),
        item(' brachte', 160, y),
        item('1996', 140, 400.3, { size: 8, width: 16 }),
      ]);
      const lines = await extract(page);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].text, 'Das Jahr 1996 brachte');
    });

    it('separates genuinely different lines', async () => {
      const extract = loadApp().get('extractPdfLines');
      const page = fakePage([
        item('erste Zeile hier steht', 57, 400),
        item('zweite Zeile hier steht', 57, 388), // normal ~12pt leading
        item('dritte Zeile hier steht', 57, 376),
      ]);
      const lines = await extract(page);
      assert.equal(lines.length, 3, 'normal leading must still separate lines');
      assert.equal(lines[0].text, 'erste Zeile hier steht');
      assert.equal(lines[2].text, 'dritte Zeile hier steht');
    });

    it('drops page numbers and running headers at the page edges', async () => {
      const extract = loadApp().get('extractPdfLines');
      const page = fakePage([
        item('166', 127, 27),                       // folio, bottom band
        item('Ein normaler Satz im Fliesstext', 57, 400),
      ]);
      const lines = await extract(page);
      assert.equal(lines.length, 1);
      assert.equal(lines[0].text, 'Ein normaler Satz im Fliesstext');
    });

    it('does not insert a space into a word split across runs', async () => {
      const extract = loadApp().get('extractPdfLines');
      const page = fakePage([
        item('Nr', 100, 400, { width: 10 }),
        item('.', 110, 400, { width: 2.5 }),
        item('4', 112.5, 400.3, { size: 8, width: 4 }),
      ]);
      const lines = await extract(page);
      assert.equal(lines[0].text, 'Nr.4', 'adjacent runs must not gain a space');
    });
  });

  describe('PDF paragraph assembly', () => {
    // extractPdfParagraphsWithPages() takes an opened pdf.js document, so the
    // fake needs numPages/getPage as well.
    function fakeDoc(pages) {
      return {
        numPages: pages.length,
        getPage: async n => pages[n - 1],
      };
    }

    function bodyLine(text, x, y) {
      return item(text, x, y);
    }

    // The body-margin vote is taken across the WHOLE document, not per page,
    // so a fixture consisting of one unusual page would elect that page's
    // quirk as the book's margin. Padding with ordinary pages is what makes
    // these fixtures representative rather than degenerate.
    const PAD = 'Fuellzeile';
    function plainPage(x0, lineCount = 30) {
      const items = [];
      let y = 600;
      for (let i = 0; i < lineCount; i++) {
        // every 5th line indented, so padding forms discrete paragraphs and
        // cannot silently run into the fixture's own first paragraph
        items.push(bodyLine(`${PAD} Nummer ${i} im gewoehnlichen Fliesstext`, i % 5 === 0 ? x0 + 14 : x0, y));
        y -= 12;
      }
      return fakePage(items);
    }
    const withoutPadding = paragraphs => paragraphs.filter(p => !p.startsWith(PAD));

    it('treats a figure-wrapped block as its own margin, not as an indent', async () => {
      // Page 166 of the Deutschmeister volume: prose at the 127.5 page margin,
      // then a run wrapping around a photo starting at 203.6, with real
      // first-line indents 14pt inside each block. Measured against the page
      // margin alone, every one of the 203.6 lines looks indented and the whole
      // wrapped run shatters into one-line paragraphs.
      const run = loadApp().get('extractPdfParagraphsWithPages');
      const items = [];
      let y = 570;
      // main-column paragraph (>=15 chars so it counts toward the margin vote);
      // its first line is indented so it starts cleanly after the padding
      items.push(bodyLine('tere Minister fuer Landesverteidigung Otto', 141.7, y)); y -= 12;
      for (const t of [
                       'woechige Uebung beim Bataillon abgeleistet',
                       'gelten dass auch der heutige Praesident des']) {
        items.push(bodyLine(t, 127.5, y)); y -= 12;
      }
      // indented first line of a new paragraph, still in the main column
      items.push(bodyLine('Die Zeit reifte nun auch im Bundesheer fuer', 141.7, y)); y -= 12;
      // wrapped block beside the figure
      for (const t of ['taerischen Traditionen heran Mit Tagesbefehl',
                       'ministers fuer Landesverteidigung Dr Georg',
                       'selbst Offizier war wurde am Nationalfeiertag',
                       'Wiederaufnahme der Traditionspflege der Alten',
                       'und des Ersten Bundesheeres angeordnet Mit']) {
        items.push(bodyLine(t, 203.6, y)); y -= 12;
      }
      // a genuine indent *inside* the wrapped block
      items.push(bodyLine('Kommandant des Bataillons war seit September', 217.7, y)); y -= 12;
      items.push(bodyLine('Oberstleutnant Karl Fahringer der mit Juli', 203.6, y));

      // pages 1-3 are ordinary body pages at the 127.5 margin so the global
      // margin vote elects 127.5; the figure-wrapped page is page 4 (even
      // parity, matching the real page 166).
      const { paragraphs } = await run(fakeDoc([
        plainPage(127.5), plainPage(127.5), plainPage(127.5), fakePage(items),
      ]));
      const wrapped = withoutPadding(paragraphs);

      assert.equal(wrapped.length, 3, `expected 3 paragraphs, got ${JSON.stringify(wrapped, null, 1)}`);
      assert.ok(wrapped[0].startsWith('tere Minister'), 'main-column paragraph');
      assert.ok(wrapped[1].startsWith('Die Zeit reifte'), 'indent starts a paragraph and the wrapped run continues it');
      assert.includes(wrapped[1], 'und des Ersten Bundesheeres', 'wrapped block joined rather than fragmented');
      assert.ok(wrapped[2].startsWith('Kommandant des'), 'indent inside the wrapped block still detected');
    });

    it('still detects an ordinary first-line indent', async () => {
      const run = loadApp().get('extractPdfParagraphsWithPages');
      const items = [];
      let y = 500;
      for (const t of ['erste Zeile des ersten Absatzes hier',
                       'zweite Zeile des ersten Absatzes hier',
                       'dritte Zeile des ersten Absatzes hier']) {
        items.push(bodyLine(t, 57, y)); y -= 12;
      }
      items.push(bodyLine('erste Zeile des zweiten Absatzes', 71, y)); y -= 12;
      items.push(bodyLine('zweite Zeile des zweiten Absatzes', 57, y));
      const { paragraphs } = await run(fakeDoc([fakePage(items)]));
      assert.equal(paragraphs.length, 2, JSON.stringify(paragraphs));
      assert.ok(paragraphs[1].startsWith('erste Zeile des zweiten'), 'indent began a new paragraph');
    });

    it('does not mistake a repeated 14pt indent for a column margin', async () => {
      // Guardrail on the block-margin heuristic: a page where many paragraphs
      // are indented must not conclude that the indent position is a margin.
      const run = loadApp().get('extractPdfParagraphsWithPages');
      const items = [];
      let y = 600;
      for (let p = 0; p < 5; p++) {
        items.push(bodyLine(`erste Zeile des Absatzes Nummer ${p}`, 71, y)); y -= 12;
        items.push(bodyLine(`zweite Zeile des Absatzes Nummer ${p}`, 57, y)); y -= 12;
      }
      const { paragraphs } = await run(fakeDoc([plainPage(57), plainPage(57), fakePage(items)]));
      const body = withoutPadding(paragraphs);
      assert.equal(body.length, 5, JSON.stringify(body));
    });
  });

  // Heading detection is what the optional "split into chapters" checkbox runs
  // on a PDF that carries no outline of its own. Every case below is a real
  // false positive from the books in books/, reduced to the shape that caused
  // it.
  describe('heading detection', () => {
    const BODY = 'Ein hinreichend langer Absatz, der als Fliesstext durchgeht und nicht als Ueberschrift. '
      + 'Er ist bewusst laenger als achtzig Zeichen.';

    function headings(paragraphs) {
      const { get } = loadApp();
      return get('detectHeadingIndices')(paragraphs).map(i => paragraphs[i]);
    }

    it('finds a heading standing alone between two runs of prose', () => {
      assert.deepEqual(headings([BODY, 'Kapitel II', BODY, BODY]), ['Kapitel II']);
    });

    it('ignores a title page', () => {
      // Satow vol. 2: five short lines in a row, the last of them followed by
      // real prose, which used to make "Edited and Annotated by Ian C. Ruxton"
      // a chapter.
      assert.deepEqual(headings([
        'The Diaries of Sir Ernest Satow',
        'British Envoy in Peking (1900-06)',
        'In Two Volumes',
        'Volume One: 1900-03',
        'Volume Two: 1904-06',
        'Edited and Annotated by Ian C. Ruxton',
        BODY, BODY,
      ]), []);
    });

    it('ignores index and register lines', () => {
      assert.deepEqual(headings([BODY, '396 Gosselin, Martin I: 20', BODY, BODY]), []);
      assert.deepEqual(headings([BODY, '205, 211, 216, 227, brings Ishiguro', BODY, BODY]), []);
    });

    it('ignores dialogue and trailing-dash lines', () => {
      // All eight false positives in "Briefe, die ihn nicht erreichten" were
      // of these two shapes: the sentence-ending punctuation is there, just
      // not as the last character.
      assert.deepEqual(headings([BODY, '»Und hat der Kaiser wirklich dreihundert Frauen?«', BODY, BODY]), []);
      assert.deepEqual(headings([BODY, 'Vergangenheit, Vergangenheit! –', BODY, BODY]), []);
      assert.deepEqual(headings([BODY, 'An Bord des »Kaiser Wilhelm der Große.«', BODY, BODY]), []);
    });

    it('still finds a heading that follows a signature line', () => {
      // A chapter very often opens right after the line closing the previous
      // one, so two short lines in a row must stay allowed -- only three or
      // more mean a title page or a table of contents.
      assert.deepEqual(
        headings([BODY, 'Grete Litzmann', 'Einleitung', BODY, BODY]),
        ['Einleitung']
      );
    });

    it('gives up rather than shredding a document it cannot read', () => {
      const noisy = [];
      for (let i = 0; i < 40; i++) { noisy.push('Titelzeile ' + i); noisy.push(BODY); }
      assert.deepEqual(headings(noisy), [], 'too many headings to be believable');
    });

    it('recovers every chapter title of the built-in book, and nothing else', () => {
      // The strongest available check: flatten the real book back into the
      // "heading line, then body" shape an outline-less PDF of it would
      // produce, and ask for its chapters back. Before the neighbourhood
      // rules this returned 26 headings for 12 chapters.
      const { get } = loadApp();
      const flat = [];
      const wanted = [];
      get('BOOK_CHAPTERS').forEach(c => {
        wanted.push(flat.length);
        flat.push(c.title);
        c.paragraphs.forEach(par => flat.push(par));
      });
      assert.deepEqual(get('detectHeadingIndices')(flat), wanted);
    });
  });
};
