'use strict';

// Document-library lifecycle.
//
// The built-in example is a build-time constant, not a stored document, so
// "the reader deleted it" can only live as a flag in localStorage. Every
// startup path that reaches for a document has to honour that flag: the
// original first-launch code fell back to loadDefaultBook() unconditionally,
// which would have put the example straight back on the next reload and made
// deleting it look broken.
//
// Only the storage-level functions are exercised here -- deleteDocumentFromLibrary()
// itself re-renders the settings UI, which the stub DOM in lib/load.js cannot
// carry. What that function does to storage is what these assertions cover.

const { loadApp } = require('./lib/load.js');

module.exports = ({ describe, it, assert }) => {
  // Every helper below runs against the one shared vm context, so each case
  // sets up the storage state it needs and the suite puts the app back on the
  // built-in book at the end.
  function freshStorage(app) {
    app.localStorage.clear();
  }

  describe('document library', () => {
    it('remembers that the example was deleted', () => {
      const { get, app } = loadApp();
      freshStorage(app);
      assert.equal(get('isExampleRemoved')(), false, 'not removed by default');
      get('setExampleRemoved')(true);
      assert.equal(get('isExampleRemoved')(), true, 'flag persisted');
      get('setExampleRemoved')(false);
      assert.equal(get('isExampleRemoved')(), false, 'flag cleared');
    });

    it('offers the example among the available documents unless it was deleted', () => {
      const { get, app } = loadApp();
      freshStorage(app);
      const BOOK_DOC_ID = get('BOOK_DOC_ID');
      assert.deepEqual(get('availableDocumentIds')(), [BOOK_DOC_ID], 'example only');

      get('saveDocIndex')([{ id: 'doc-x', title: 'X', chapterCount: 1 }]);
      assert.deepEqual(get('availableDocumentIds')(), [BOOK_DOC_ID, 'doc-x'], 'example first');

      get('setExampleRemoved')(true);
      assert.deepEqual(get('availableDocumentIds')(), ['doc-x'], 'example gone');
    });

    it('does not load the example again after it was deleted', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      get('setExampleRemoved')(true);

      await get('loadInitialDocument')();
      assert.equal(get('currentDocId'), get('EMPTY_DOC_ID'), 'falls back to the empty placeholder');
      assert.equal(get('PARAGRAPHS').length, 0, 'nothing loaded');
      assert.equal(app.localStorage.getItem(get('CURRENT_DOC_POINTER_KEY')), null, 'no pointer left behind');
    });

    it('falls back to another saved document rather than to the empty state', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      get('setExampleRemoved')(true);
      get('saveDocIndex')([{ id: 'doc-x', title: 'X', chapterCount: 1 }]);
      app.localStorage.setItem(get('docStorageKey')('doc-x'), JSON.stringify({
        bookTitle: 'X',
        chapters: [{ id: 'c0', title: 'One', dateRange: '', paragraphs: ['Ein Satz.'] }],
      }));

      await get('loadInitialDocument')();
      assert.equal(get('currentDocId'), 'doc-x', 'opened the surviving document');
      assert.deepEqual(get('PARAGRAPHS'), ['Ein Satz.']);
    });

    it('brings the example back when it is restored', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      get('setExampleRemoved')(true);
      get('setExampleRemoved')(false); // what loadExampleText() does first

      await get('loadInitialDocument')();
      assert.equal(get('currentDocId'), get('BOOK_DOC_ID'), 'example is back');
      assert.atLeast(get('PARAGRAPHS').length, 1, 'book text loaded');
    });

    it('never persists the empty placeholder as a document', async () => {
      // Otherwise a phantom "untitled" entry appears in the library the moment
      // anything calls saveCurrentDocumentContent() while nothing is loaded.
      const { get, app } = loadApp();
      freshStorage(app);
      get('loadEmptyDocument')();
      await get('saveCurrentDocumentContent')();
      assert.deepEqual(get('loadDocIndex')(), [], 'library still empty');
      assert.equal(app.localStorage.getItem(get('CURRENT_DOC_POINTER_KEY')), null, 'no pointer written');
    });
  });

  // The blob store keeps document text and analysis caches. There is no
  // IndexedDB in the test context, so the app runs on its localStorage
  // fallback -- which is the interesting half to pin down anyway: it is the
  // one with a 5 MB ceiling, and the one every other suite runs against.
  describe('blob storage', () => {
    it('falls back to localStorage when IndexedDB never answers', async () => {
      // Not a hypothetical: a blocked or hung indexedDB.open() fires no event
      // at all, not even onerror, so waiting for one hangs the whole app on
      // startup. This is why the probe has a timeout instead.
      const { get } = loadApp();
      const hangingFactory = { open: () => ({ readyState: 'pending' }) };
      const started = Date.now();
      const db = await get('openIdbWithTimeout')(hangingFactory, 30);
      assert.equal(db, null, 'gives up rather than waiting forever');
      assert.atLeast(Date.now() - started, 25, 'it actually waited for the timeout');
    });

    it('falls back when there is no IndexedDB at all', async () => {
      const { get } = loadApp();
      assert.equal(await get('openIdbWithTimeout')(null, 1000), null);
      assert.equal(await get('openIdbWithTimeout')({ open() { throw new Error('private mode'); } }, 1000), null);
    });

    // Firefox and Safari in private browsing, and any browser at its storage
    // limit, hand back a connection that opens cleanly and then aborts every
    // transaction. Trusting the open alone was silently fatal: migration
    // leaves each document in localStorage (correct), but the backend has
    // already switched, so every read goes to IndexedDB, rejects, and
    // loadDocumentContent turns that into null -- the entire library opens
    // blank while the text is still on disk.
    describe('a backend that opens but does not work', () => {
      const brokenBackend = () => ({
        name: 'indexedDB',
        set: () => Promise.reject(new Error('transaction aborted')),
        get: () => Promise.reject(new Error('transaction aborted')),
        remove: () => Promise.reject(new Error('transaction aborted')),
        keys: () => Promise.reject(new Error('transaction aborted')),
      });

      it('is rejected by the round-trip probe', async () => {
        const { get } = loadApp();
        assert.equal(await get('idbBackendWorks')(brokenBackend()), false);
      });

      it('is rejected when writes succeed but read back nothing', async () => {
        // The subtler shape: put() resolves, the data never lands.
        const { get } = loadApp();
        const amnesiac = {
          set: () => Promise.resolve(),
          get: () => Promise.resolve(null),
          remove: () => Promise.resolve(),
        };
        assert.equal(await get('idbBackendWorks')(amnesiac), false);
      });

      it('accepts a backend that actually round-trips', async () => {
        const { get } = loadApp();
        const store = new Map();
        const working = {
          set: (k, v) => { store.set(k, v); return Promise.resolve(); },
          get: (k) => Promise.resolve(store.has(k) ? store.get(k) : null),
          remove: (k) => { store.delete(k); return Promise.resolve(); },
        };
        assert.equal(await get('idbBackendWorks')(working), true);
        assert.equal(store.size, 0, 'the probe must clean up after itself');
      });
    });

    it('keeps the document index out of blob storage', () => {
      // DOC_INDEX_KEY starts with DOC_STORAGE_PREFIX, so a naive prefix match
      // would migrate the index itself into async storage -- where every
      // synchronous reader of it (availableDocumentIds, the library list)
      // would find nothing and conclude the library was empty.
      const { get } = loadApp();
      assert.equal(get('isBlobKey')(get('DOC_INDEX_KEY')), false, 'the index stays put');
      assert.equal(get('isBlobKey')(get('docStorageKey')('doc-x')), true);
      assert.equal(get('isBlobKey')(get('CACHE_STORAGE_PREFIX') + 'doc-x:c0'), true);
      assert.equal(get('isBlobKey')(get('SETTINGS_KEY')), false);
    });

    it('migrates existing blobs out of localStorage and leaves everything else', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      app.localStorage.setItem(get('docStorageKey')('doc-x'), '{"chapters":[]}');
      app.localStorage.setItem(get('CACHE_STORAGE_PREFIX') + 'doc-x:c0', '{"k":1}');
      app.localStorage.setItem(get('DOC_INDEX_KEY'), '[]');
      app.localStorage.setItem(get('SETTINGS_KEY'), '{}');

      const written = new Map();
      await get('migrateBlobsToIdb')({ set: (k, v) => { written.set(k, v); return Promise.resolve(); } });

      assert.equal(written.size, 2, 'both blobs copied');
      assert.equal(written.get(get('docStorageKey')('doc-x')), '{"chapters":[]}');
      assert.equal(app.localStorage.getItem(get('docStorageKey')('doc-x')), null, 'freed from localStorage');
      assert.equal(app.localStorage.getItem(get('DOC_INDEX_KEY')), '[]', 'index untouched');
      assert.equal(app.localStorage.getItem(get('SETTINGS_KEY')), '{}', 'settings untouched');
    });

    it('leaves a blob in localStorage when copying it fails', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      const key = get('docStorageKey')('doc-y');
      app.localStorage.setItem(key, 'payload');
      await get('migrateBlobsToIdb')({ set: () => Promise.reject(new Error('quota')) });
      assert.equal(app.localStorage.getItem(key), 'payload', 'not deleted before it was safely copied');
    });

    it('reports what storage is holding', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      app.localStorage.setItem(get('docStorageKey')('doc-x'), 'abcde'); // 5 chars
      const usage = await get('blobUsage')();
      assert.equal(usage.backend, 'localStorage');
      assert.equal(usage.bytes, 10, 'UTF-16 code units, the way browsers charge for localStorage');
      assert.ok(usage.limit, 'the localStorage backend knows it has a ceiling');
    });

    it('recognises a quota failure whatever the browser calls it', () => {
      const { get } = loadApp();
      const isQuotaError = get('isQuotaError');
      assert.equal(isQuotaError({ name: 'QuotaExceededError' }), true);
      assert.equal(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true, 'Firefox');
      assert.equal(isQuotaError({ name: 'Error', message: 'Quota exceeded.' }), true);
      assert.equal(isQuotaError({ name: 'AbortError', message: 'aborted' }), false);
      assert.equal(isQuotaError(null), false);
    });
  });

  describe('analysis cache scoping', () => {
    it('clears one document without touching the others', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      const PREFIX = get('CACHE_STORAGE_PREFIX');
      app.localStorage.setItem(PREFIX + 'doc-a:ch1', '{}');
      app.localStorage.setItem(PREFIX + 'doc-a:ch2', '{}');
      app.localStorage.setItem(PREFIX + 'doc-b:ch1', '{}');

      await get('clearDocumentCache')('doc-a');
      assert.equal(app.localStorage.getItem(PREFIX + 'doc-a:ch1'), null);
      assert.equal(app.localStorage.getItem(PREFIX + 'doc-a:ch2'), null, 'all chapters of that document');
      assert.equal(app.localStorage.getItem(PREFIX + 'doc-b:ch1'), '{}', 'other documents untouched');
    });

    it('drops the in-memory copy when the cleared document is the open one', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      await get('loadInitialDocument')(); // the built-in book
      const cache = get('cache');
      cache.set('ch:1', { grammarHtml: 'x', vocabHtml: 'y' });

      await get('clearDocumentCache')('some-other-doc');
      assert.equal(cache.size, 1, 'a different document must not evict what is on screen');

      await get('clearDocumentCache')(get('currentDocId'));
      assert.equal(cache.size, 0, 'the open document is cleared in memory too');
    });

    it('deleting a document takes its cache and reading position with it', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      const PREFIX = get('CACHE_STORAGE_PREFIX');
      get('saveDocIndex')([{ id: 'doc-x', title: 'X', chapterCount: 1 }]);
      app.localStorage.setItem(get('docStorageKey')('doc-x'), '{}');
      app.localStorage.setItem(PREFIX + 'doc-x:c0', '{}');
      app.localStorage.setItem(get('CHAPTER_INDEX_KEY_PREFIX') + 'doc-x', '3');

      // the storage half of deleteDocumentFromLibrary(); the rest is rendering
      app.localStorage.removeItem(get('docStorageKey')('doc-x'));
      app.localStorage.removeItem(get('CHAPTER_INDEX_KEY_PREFIX') + 'doc-x');
      await get('clearDocumentCache')('doc-x');
      get('saveDocIndex')(get('loadDocIndex')().filter(d => d.id !== 'doc-x'));

      assert.deepEqual(get('loadDocIndex')(), []);
      assert.equal(app.localStorage.getItem(PREFIX + 'doc-x:c0'), null, 'no orphan cache left');
      assert.equal(app.localStorage.getItem(get('CHAPTER_INDEX_KEY_PREFIX') + 'doc-x'), null);
    });
  });

  describe('cleanup', () => {
    it('leaves the app on the built-in book for the following suites', async () => {
      const { get, app } = loadApp();
      freshStorage(app);
      await get('loadInitialDocument')();
      assert.equal(get('currentDocId'), get('BOOK_DOC_ID'));
    });
  });
};
