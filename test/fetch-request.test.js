'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fetchRequest = require('../lib/helpers/fetch-request');

test('fetch-request sends form bodies and returns response text', async () => {
  const originalFetch = global.fetch;
  let fetchArgs;

  global.fetch = async (url, options) => {
    fetchArgs = { url, options };
    return {
      ok: true,
      text: async () => 'ok'
    };
  };

  try {
    const result = await fetchRequest({
      url: 'http://example.test/form',
      method: 'POST',
      form: { alpha: '1', beta: 'two words' }
    });

    assert.equal(result, 'ok');
    assert.equal(fetchArgs.url, 'http://example.test/form');
    assert.equal(fetchArgs.options.method, 'POST');
    assert.equal(fetchArgs.options.body, 'alpha=1&beta=two+words');
    assert.equal(fetchArgs.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetch-request parses json responses when requested', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ status: 'success', source: 'mock' })
  });

  try {
    const result = await fetchRequest({
      url: 'http://example.test/json',
      json: true
    });

    assert.deepEqual(result, { status: 'success', source: 'mock' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetch-request exposes status and body on non-2xx responses', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    status: 503,
    text: async () => 'temporarily unavailable'
  });

  try {
    await assert.rejects(
      fetchRequest({
        url: 'http://example.test/error'
      }),
      (error) => {
        assert.equal(error.status, 503);
        assert.equal(error.body, 'temporarily unavailable');
        assert.match(error.message, /Request failed with status 503/);
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('fetch-request clears the timeout when fetch rejects', async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    throw error;
  };

  try {
    await assert.rejects(
      fetchRequest({
        url: 'http://example.test/timeout',
        timeout: 25
      }),
      (error) => error.name === 'AbortError'
    );
  } finally {
    global.fetch = originalFetch;
  }
});
