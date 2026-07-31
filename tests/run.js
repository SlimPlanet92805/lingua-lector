#!/usr/bin/env node
'use strict';

// Test runner. Usage:
//   node tests/run.js            run everything
//   node tests/run.js i18n pdf   run only suites whose filename matches
//
// Requires nothing but Node. Run `python build.py` first — the suite tests
// dist/lingua-lector.html, so that the build step itself is covered.

const fs = require('fs');
const path = require('path');
const { run } = require('./lib/harness.js');

const filters = process.argv.slice(2);

const files = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => filters.length === 0 || filters.some(x => f.includes(x)))
  .sort()
  .map(f => path.join(__dirname, f));

if (!files.length) {
  console.error('no test files matched');
  process.exit(1);
}

run(files).then(ok => process.exit(ok ? 0 : 1)).catch(err => {
  console.error(err);
  process.exit(1);
});
