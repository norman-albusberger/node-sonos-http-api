'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const serveMountedStatic = require('../lib/helpers/serve-mounted-static');

test('serveMountedStatic strips the mount prefix while serving and restores the original url afterwards', async () => {
  const req = { url: '/tts/example.mp3' };
  const res = {};
  const seenUrls = [];

  await new Promise((resolve) => {
    serveMountedStatic('/tts', (innerReq, innerRes, next) => {
      seenUrls.push(innerReq.url);
      next();
    }, req, res, () => {
      seenUrls.push(req.url);
      resolve();
    });
  });

  assert.deepEqual(seenUrls, ['/example.mp3', '/tts/example.mp3']);
});

test('serveMountedStatic falls through for non-matching urls', async () => {
  const req = { url: '/status' };
  let serveCalled = false;

  await new Promise((resolve) => {
    serveMountedStatic('/tts', () => {
      serveCalled = true;
    }, req, {}, resolve);
  });

  assert.equal(serveCalled, false);
});
