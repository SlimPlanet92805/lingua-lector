'use strict';

// The analysis panel writes model output into innerHTML (part5_js_render:
// grammarHtml/vocabHtml and the chat turns). That is only safe because
// inlineMd() escapes the text *first* and then re-introduces a fixed, tiny set
// of tags. Nothing enforces that ordering, so the day someone adds link or
// table syntax to inlineMd -- reasonable-looking markdown features that emit
// attributes -- the panel becomes an injection point for whatever the model
// was talked into saying.
//
// So this suite pins the invariant rather than the implementation: whatever
// mdToHtml emits, the only tags in it come from the whitelist below. A new
// markdown feature has to extend that list deliberately, in a diff someone
// reviews, instead of silently widening what the model can inject.

const { loadApp } = require('./lib/load.js');

// Tags mdToHtml is allowed to produce. `span` is listed with its class because
// that is the only attribute the renderer ever emits -- an attacker-controlled
// attribute anywhere is the thing we are actually guarding against.
const ALLOWED_TAGS = new Set([
  'strong', 'code', 'em',
  'h3', 'h4', 'p', 'ul', 'ol', 'li', 'br',
  'span',
]);

// Inputs a hostile or prompt-injected model response might contain. These are
// not expected to be *rejected* -- they should render as visible text.
const HOSTILE_INPUTS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '**<script>alert(1)</script>**',
  '`</code><script>alert(1)</script>`',
  '*</span><img src=x onerror=alert(1)>*',
  '- <iframe src="javascript:alert(1)"></iframe>',
  '## <svg onload=alert(1)>',
  '1. <a href="javascript:alert(1)">click</a>',
  '<div onclick="alert(1)">x</div>',
  '&lt;script&gt;alert(1)&lt;/script&gt;',
  '<!-- --><script>alert(1)</script>',
  '**bold** <object data="x"></object>',
  '   <base href="http://evil.example/">',
  '<form action="http://evil.example"><input name=q></form>',

  // Markdown *syntax*, not raw HTML. The cases above are all escaped away
  // today, which means they cannot detect a newly added markdown feature --
  // the actual risk here. These are the shapes a future link/image/table/
  // autolink implementation would act on, so they fail the moment one lands
  // without a matching decision about attributes.
  '[click](javascript:alert(1))',
  '[click](http://evil.example)',
  '![alt](http://evil.example/x.png)',
  '![alt](javascript:alert(1))',
  '<http://evil.example>',
  '[ref][1]\n\n[1]: javascript:alert(1)',
  '| a | b |\n| --- | --- |\n| c | d |',
  '<https://evil.example/"onmouseover="alert(1)>',
];

// Pulls every tag name out of rendered HTML, plus whether it carried any
// attribute other than the renderer's own class="de".
function inspectTags(html) {
  const tags = [];
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)) {
    tags.push({ name: m[1].toLowerCase(), attrs: (m[2] || '').trim() });
  }
  return tags;
}

module.exports = ({ describe, it, assert }) => {
  describe('markdown rendering — escaping', () => {
    it('emits no tag outside the whitelist, for any input', () => {
      const { get } = loadApp();
      const mdToHtml = get('mdToHtml');
      for (const input of HOSTILE_INPUTS) {
        const html = mdToHtml(input);
        for (const { name } of inspectTags(html)) {
          assert.ok(
            ALLOWED_TAGS.has(name),
            `mdToHtml(${JSON.stringify(input)}) produced <${name}>, which is not whitelisted -- ` +
            `if this tag is intentional, add it to ALLOWED_TAGS here`
          );
        }
      }
    });

    it('never emits an attacker-controlled attribute', () => {
      const { get } = loadApp();
      const mdToHtml = get('mdToHtml');
      for (const input of HOSTILE_INPUTS) {
        const html = mdToHtml(input);
        for (const { name, attrs } of inspectTags(html)) {
          // class="de" on <span> is the renderer's own; nothing else may carry
          // attributes at all, which rules out href/src/on* in one stroke.
          const ok = attrs === '' || (name === 'span' && attrs === 'class="de"');
          assert.ok(
            ok,
            `mdToHtml(${JSON.stringify(input)}) produced <${name} ${attrs}> -- ` +
            `rendered markdown must not carry attributes`
          );
        }
      }
    });

    it('renders hostile markup as visible text rather than dropping it', () => {
      const { get } = loadApp();
      const mdToHtml = get('mdToHtml');
      // Escaping that silently swallowed the input would also pass the checks
      // above, so confirm the reader still sees what the model said.
      const html = mdToHtml('<script>alert(1)</script>');
      assert.ok(html.includes('&lt;script&gt;'), `expected escaped text, got ${html}`);
      assert.ok(!html.includes('<script'), `raw <script survived: ${html}`);
    });

    it('escapes the five characters that matter', () => {
      const { get } = loadApp();
      const escapeHtml = get('escapeHtml');
      assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
      // & must be replaced first or the other entities get double-escaped
      assert.equal(escapeHtml('<'), '&lt;');
      assert.equal(escapeHtml('&lt;'), '&amp;lt;');
    });

    it('keeps the markdown it is supposed to support', () => {
      const { get } = loadApp();
      const mdToHtml = get('mdToHtml');
      assert.ok(mdToHtml('**bold**').includes('<strong>bold</strong>'), 'bold');
      assert.ok(mdToHtml('`code`').includes('<code>code</code>'), 'code');
      assert.ok(mdToHtml('*foreign*').includes('<span class="de">foreign</span>'), 'emphasis span');
      assert.ok(mdToHtml('## Heading').includes('<h3>Heading</h3>'), 'h2 renders as h3');
      assert.ok(mdToHtml('- item').includes('<li>item</li>'), 'bullet');
    });
  });
};
