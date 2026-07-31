'use strict';

// Minimal test harness. Deliberately dependency-free: Lingua Lector ships as a
// single zero-dependency HTML file, and a test suite that needs `npm install`
// before it will run is a test suite that stops getting run. Everything here
// works with a bare `node`.

const suites = [];

function describe(name, fn) {
  suites.push({ name, tests: [], fn });
}

let current = null;
function it(name, fn) {
  if (!current) throw new Error('it() outside describe()');
  current.tests.push({ name, fn });
}

function fail(msg) {
  throw new Error(msg);
}

const assert = {
  ok(value, msg) {
    if (!value) fail(msg || `expected truthy, got ${JSON.stringify(value)}`);
  },
  equal(actual, expected, msg) {
    if (actual !== expected) {
      fail(`${msg ? msg + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },
  deepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) fail(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
  },
  includes(haystack, needle, msg) {
    if (!haystack.includes(needle)) {
      fail(`${msg ? msg + ': ' : ''}expected to find ${JSON.stringify(needle)}`);
    }
  },
  notIncludes(haystack, needle, msg) {
    if (haystack.includes(needle)) {
      fail(`${msg ? msg + ': ' : ''}expected NOT to find ${JSON.stringify(needle)}`);
    }
  },
  // Regression guardrails are usually "no worse than a known-good number"
  // rather than an exact value -- exact counts on real books churn on every
  // content tweak and train people to update the expectation without reading.
  atMost(actual, limit, msg) {
    if (!(actual <= limit)) fail(`${msg ? msg + ': ' : ''}expected <= ${limit}, got ${actual}`);
  },
  atLeast(actual, limit, msg) {
    if (!(actual >= limit)) fail(`${msg ? msg + ': ' : ''}expected >= ${limit}, got ${actual}`);
  },
};

async function run(files) {
  for (const file of files) {
    const mod = require(file);
    if (typeof mod === 'function') mod({ describe, it, assert });
  }

  let passed = 0;
  const failures = [];

  for (const suite of suites) {
    current = suite;
    suite.fn();
    current = null;
    console.log(`\n${suite.name}`);
    for (const test of suite.tests) {
      try {
        await test.fn();
        passed++;
        console.log(`  ✓ ${test.name}`);
      } catch (err) {
        failures.push({ suite: suite.name, test: test.name, err });
        console.log(`  ✗ ${test.name}`);
        console.log(`      ${err.message.split('\n').join('\n      ')}`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  return failures.length === 0;
}

module.exports = { describe, it, assert, run };
