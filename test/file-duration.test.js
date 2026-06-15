'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fileDurationPath = require.resolve('../lib/helpers/file-duration');
const musicMetadataPath = require.resolve('music-metadata');

test('file-duration returns rounded-up milliseconds from music-metadata', async () => {
  const originalMusicMetadata = require.cache[musicMetadataPath];
  const originalFileDuration = require.cache[fileDurationPath];

  require.cache[musicMetadataPath] = {
    id: musicMetadataPath,
    filename: musicMetadataPath,
    loaded: true,
    exports: {
      parseFile(path, options) {
        assert.equal(path, '/tmp/example.wav');
        assert.deepEqual(options, { duration: true });
        return Promise.resolve({
          format: {
            duration: 1.234
          }
        });
      }
    }
  };

  delete require.cache[fileDurationPath];

  try {
    const fileDuration = require('../lib/helpers/file-duration');
    const duration = await fileDuration('/tmp/example.wav');

    assert.equal(duration, 1234);
  } finally {
    if (originalMusicMetadata) {
      require.cache[musicMetadataPath] = originalMusicMetadata;
    } else {
      delete require.cache[musicMetadataPath];
    }

    if (originalFileDuration) {
      require.cache[fileDurationPath] = originalFileDuration;
    } else {
      delete require.cache[fileDurationPath];
    }
  }
});
