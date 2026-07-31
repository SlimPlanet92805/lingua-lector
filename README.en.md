<p align="right">English · <a href="README.md">简体中文</a></p>

<img src="docs/logo.svg" width="72" alt="Lingua Lector">

# Lingua Lector — AI-Powered Close Reading for Foreign-Language Texts

**Single file, pure frontend, BYOK.** Load any foreign-language text, click a sentence, and
the AI takes it apart for you — with your own API key, no account, no backend.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue?style=flat-square)](LICENSE)
![Single HTML file](https://img.shields.io/badge/Single-HTML%20file-orange?style=flat-square)
![Pure frontend](https://img.shields.io/badge/Pure-frontend-brightgreen?style=flat-square)
![No backend](https://img.shields.io/badge/No-backend-lightgrey?style=flat-square)
![BYOK](https://img.shields.io/badge/BYOK-bring%20your%20own%20key-9cf?style=flat-square)
![No install](https://img.shields.io/badge/No-install-yellow?style=flat-square)

## What it is

This is a reader built specifically for Elisabeth von Heyking's German diary *Tagebücher aus
vier Weltteilen* — but you can absolutely read other things with it!

Seriously, though: load a text (`.txt` / `.docx` / `.pdf` / `.epub`, or pasted straight in),
and it comes back split into clickable sentences. Click one and the right-hand panel gives
you its structure and its vocabulary, with follow-up questions available underneath. The
whole tool is one HTML file you open by double-clicking it. The diary ships inside it as the
example book, and can be deleted.

![Lingua Lector demo](docs/demo.en.gif)

## Why this exists

This book is written in long sentences. One main clause can hold a `nachdem` adverbial
clause, stack two layers of `daß` object clauses inside it, and take on two appositions and
two relative clauses along the way, running to nearly nine hundred characters without
coordinating once (see "One example" at the bottom — the record holder comes from the
introduction by the book's editor, Grete Litzmann, and von Heyking herself is not much
gentler). The 1926 volume reads like that throughout: a German diplomat's wife writing from
Valparaíso, Calcutta, Cairo, Peking and Mexico, in century-old German.

Which makes reading it go: read a sentence, stop, look a word up, untangle the clauses,
realise you've forgotten how the sentence started, go back, re-read, move on. Ten stops a page.

This tool exists to remove those ten stops: click a sentence, and the panel tells you how
it's built, what each clause says, and which words are worth remembering. Then you read on.
It turned out other books needed this too, so it grew into a general close-reading tool for
any Latin-alphabet text.

## Features

- **Sentence-level analysis with follow-ups**: a translation of the whole sentence, its
  backbone, and **a translation of every subordinate clause** — not just "relative clause,
  modifies *Kaiser*", but what that half of the sentence says. The enclosing paragraph goes
  along as context, while the analysis stays strictly scoped to the sentence you clicked
- **Answers stay local**: cached per document, surviving refreshes and document switches
  without paying for the same sentence twice. Re-analyse a single sentence you don't like,
  or clear one document's cache, without wiping everything
- **Document library**: the built-in book plus as many imports as you like, each with its own
  cache and reading position. Text and caches live in IndexedDB (falling back to
  `localStorage`), so a several-hundred-page book fits, and the library shows what each costs
- **Multi-format import**: `.txt` / `.docx` / `.pdf` / `.epub`, all parsed in the browser —
  files never leave your machine
- **Position-aware PDF extraction**: lines grouped by text coordinates, running headers and
  page numbers stripped, footnotes kept intact, a PDF's own bookmarks used for chapters
- **Multiple AI providers**: Anthropic Claude, any OpenAI-compatible endpoint (DeepSeek,
  Groq, NVIDIA, a local Ollama), and Google Gemini, each with its own key, model and base URL
- **Three language settings that don't affect each other**, in any combination: what language
  the interface is in (9), whose sentence-splitting rules apply to the source text
  (11 Latin-alphabet languages plus a generic fallback), and what language the AI writes its
  analysis in (15, or type your own). German source, Chinese interface, English analysis is a
  perfectly ordinary setup
- **Built-in book**: all 12 chapters of *Tagebücher aus vier Weltteilen* with a slide-out
  table of contents; delete it if you don't want it, restore it with one click
- **Reading settings**: paginate by paragraph count, adaptive one-screen pages, or no
  pagination; light / dark / sepia; adjustable reading font and size

## Quick start

1. Download `dist/lingua-lector.html`
2. Open it in a browser (Chrome / Edge / Firefox)
3. The settings panel opens on first launch — pick a provider and paste in your API key
4. The built-in book is there to read; or import a file / paste text under the Document tab
5. Click any sentence. Press ⟳ on the panel to redo an answer you don't like

## API keys

- **Anthropic Claude**: [console.anthropic.com](https://console.anthropic.com/settings/keys)
- **OpenAI** (or DeepSeek / Groq / NVIDIA / a local Ollama — point the Base URL at it):
  [platform.openai.com](https://platform.openai.com/api-keys)
- **Google Gemini**: [Google AI Studio](https://aistudio.google.com/apikey)

Create a dedicated key for this tool and give it a spend limit.

**Opening this HTML file as a claude.ai Artifact** (how the project started): pick Anthropic
and leave the key blank — requests go through claude.ai's sandbox proxy on your current
session. That fallback is Anthropic-only.

## Where the key lives

In your browser's `localStorage`, on this device, and nowhere else; it is never sent anywhere
except the provider's own endpoint. It isn't part of the HTML file, so forwarding that file
or pushing it to GitHub hands someone an empty settings panel. The only real exposure is
someone else using this device — so don't leave a key on a shared computer.

If you would rather the key not sit in the browser at all, the proxy below moves it
server-side, and the browser never touches the real one.

## Optional proxy

Anthropic and Gemini both allow direct cross-origin calls from a browser, so normally no
proxy is needed. Some OpenAI-compatible providers don't, which shows up as "network request
failed" — a proxy works around that, and can hold the key for you as well.

**`server.py`** (needs Python, no third-party dependencies) relays API requests and also
serves `dist/lingua-lector.html` over `http://`, opening it for you:

```bash
# relay only, no security benefit: the key still comes from the browser
python3 server.py

# key held server-side; the browser never sees a real one
python3 server.py --anthropic-key sk-ant-... --openai-key sk-... --gemini-key AIza...
```

Then set the provider's Base URL to `http://localhost:8787/anthropic`,
`http://localhost:8787/openai/v1`, or `http://localhost:8787/gemini/v1beta`. Remaining
options are in `python3 server.py --help`.

**`cloudflare-worker.js`** does the same on Cloudflare's free tier with nothing installed
locally: create a Worker at [dash.cloudflare.com](https://dash.cloudflare.com), paste in the
full contents of this repo's `cloudflare-worker.js`, deploy, optionally add
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` as secrets under Settings →
Variables, and set the Base URL to `https://your-worker-url/anthropic`.

Both are plain relays that don't log or inspect content; `server.py` binds to localhost only.

## Coverage

| Format | Implementation | Notes |
|---|---|---|
| `.txt` | native `File.text()` | paragraphs split on blank lines |
| `.docx` | [mammoth.js](https://github.com/mwilliamson/mammoth.js) | plain text, no formatting preserved |
| `.pdf` | [pdf.js](https://mozilla.github.io/pdf.js/) | lines grouped by coordinates, headers/page numbers stripped, footnotes preserved, own bookmarks used for chapters; text-layer PDFs only |
| `.epub` | [epub.js](https://github.com/futurepress/epub.js) + [JSZip](https://stuk.github.io/jszip/) | chapters follow the epub's table of contents |

Sentence splitting is verified for German, English, French, Spanish, Italian, Portuguese,
Dutch, Latin, Czech, Polish and Turkish, plus a generic Latin-alphabet fallback. CJK,
Cyrillic and other non-Latin scripts need fundamentally different segmentation, and forcing
them through this algorithm would work badly — that's a known boundary. AI output language
and UI language are not limited this way.

## Known limitations

- Dependencies load from a CDN, so it doesn't work offline (first-time docx/pdf/epub import
  and every analysis call need the network)
- Scanned PDFs need OCR, which this tool doesn't include
- A PDF with no bookmarks imports as a single chapter. "Try to detect headings and split into
  chapters" will attempt it, using a paragraph-shape heuristic: right on cleanly typeset
  books, unreliable on index-heavy ones, so check the result
- Sentence splitting is rule-based and does worse on messy source text (OCR noise)
- Some AI providers don't allow direct cross-origin calls from a browser — see above

## Development

```
lingua-lector/
├── dist/lingua-lector.html   # the only file you actually need
├── examples/                 # source data for the built-in book (public domain), one JSON per chapter
├── src/part1..6              # source split by concern: CSS / body / core / import / render / init
├── build.py                  # concatenates src into dist/lingua-lector.html
├── server.py                 # optional local proxy
└── cloudflare-worker.js      # optional Cloudflare proxy
```

```bash
python3 build.py && node tests/run.js
```

The suite needs nothing but Node — no `npm install`, because a test suite you have to install
first is one that stops getting run. It runs against the **built artifact**, so `build.py`'s
concatenation and placeholder injection are covered too: build first, then test. Run a subset
by filename: `node tests/run.js i18n`.

| File | Covers |
| --- | --- |
| `build-integrity.test.js` | placeholder substitution, tag balance, inline JS syntax, dangling `getElementById` references |
| `i18n.test.js` | key coverage across nine languages, `{placeholder}` consistency, pager rendering, one shared order for all three language lists, buttons named in instructions actually existing |
| `library.test.js` | document-library lifecycle, storage-backend selection and migration, per-document cache isolation |
| `sentences.test.js` | multi-language splitting edge cases plus statistical guardrails over the whole book |
| `properties.test.js` | 2000 seeded pathological inputs, invariants asserted per case, plus an English corpus regression |
| `pdf-layout.test.js` | PDF line assembly, paragraph splitting, heading detection (recall checked against the built-in book, precision against real false positives) |
| `prompt.test.js` | system-prompt literals, translation-label rewriting, chapter-split fallbacks, provider defaults |
| `a11y.test.js` | language tagging, keyboard reachability, live regions and dialog semantics, icon-button names, theme contrast |

## One example

One of the longest single sentences in the book, from the editor's introduction:

> Nach einjährigem Urlaub, den das Paar in völliger Stille in Florenz verlebt, nimmt er
> schweren Herzens eine Anstellung als stellvertretender Konsul in New York an, nachdem
> Freunde im Auswärtigen Amt in Berlin ihm versichert haben, daß seinem Übergang aus der
> Konsulatskarriere in den eigentlichen diplomatischen Dienst bei allernächster Gelegenheit
> nichts im Wege stände; ein verhängnisvoller Irrtum, bei dem für jeden, dem die Verhältnisse
> im diplomatischen Dienst in den achtziger Jahren bekannt sind, die Vermutung naheliegt,
> dieser freundschaftliche Rat sei, den Gebern vielleicht selbst nicht bewußt, mit davon
> beeinflußt gewesen, daß Heykings Ausscheiden aus dem Amt in Berlin seine Freunde der
> Aufgabe überhob, sich öffentlich zu ihm zu bekennen, eine Aufgabe, die allerdings
> angesichts des höfischen Einflusses seiner Gegner ein großes Maß von Selbständigkeit
> erfordert hätte!

One main clause, a `nachdem` adverbial clause, two layers of `daß` object clauses, two
appositions, two relative clauses, and nearly nine hundred characters held up entirely by
subordination. Taking that apart is what the tool does:

![the longest sentence, analysed](docs/longest-sentence-analysis.png)

## Acknowledgments

- The built-in example text is the complete *Tagebücher aus vier Weltteilen* by Elisabeth
  von Heyking (1926 edition, ed. Grete Litzmann), now in the public domain
- File parsing relies on [mammoth.js](https://github.com/mwilliamson/mammoth.js)
  (BSD-2-Clause), [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0),
  [epub.js](https://github.com/futurepress/epub.js) (BSD-2-Clause), and
  [JSZip](https://github.com/Stuk/jszip) (dual MIT/GPLv3)
- Developed mainly with Claude (Anthropic)

## License

AGPL-3.0, see [LICENSE](LICENSE). AGPL rather than MIT so improvements flow back: anyone who
modifies this and runs it as a public service has to publish their modified source. Personal
use, forking, and self-hosting are unaffected.
