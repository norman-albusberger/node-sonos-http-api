'use strict';

// The previous version of this test stubbed music-metadata through
// require.cache. That no longer works for two reasons: require.resolve() on an
// ESM-only package throws ERR_PACKAGE_PATH_NOT_EXPORTED, and a dynamic import()
// does not consult require.cache at all. So this test exercises the real path
// instead — which is exactly the path that was broken: dynamic import of the
// ESM music-metadata, parseFile, and the millisecond rounding.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fileDuration = require('../lib/helpers/file-duration');

// 8 kHz, 8 bit, mono => 8000 bytes per second. 8500 bytes of PCM is 1.0625 s,
// i.e. 1062.5 ms, which also exercises the Math.ceil() rounding (-> 1063).
const SAMPLE_RATE = 8000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 8;
const BYTE_RATE = (SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE) / 8;
const DATA_BYTES = 8500;
const EXPECTED_MS = Math.ceil((DATA_BYTES / BYTE_RATE) * 1000);

function writeWav(filePath) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + DATA_BYTES, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);                                 // PCM chunk size
  header.writeUInt16LE(1, 20);                                  // format: PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTE_RATE, 28);
  header.writeUInt16LE((CHANNELS * BITS_PER_SAMPLE) / 8, 32);   // block align
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(DATA_BYTES, 40);

  // 8-bit PCM is unsigned, so 0x80 is silence.
  fs.writeFileSync(filePath, Buffer.concat([header, Buffer.alloc(DATA_BYTES, 0x80)]));
}

function withWavFile(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonos-file-duration-'));
  const wav = path.join(dir, 'tone.wav');
  writeWav(wav);

  return Promise.resolve(fn(wav)).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('resolves the ESM music-metadata and returns rounded-up milliseconds', async () => {
  await withWavFile(async (wav) => {
    const duration = await fileDuration(wav);

    assert.equal(typeof duration, 'number', 'duration must be a number');
    assert.ok(Number.isInteger(duration), `expected integer ms, got ${duration}`);
    assert.ok(
        Math.abs(duration - EXPECTED_MS) <= 1,
        `expected ~${EXPECTED_MS} ms, got ${duration}`
    );
  });
});

test('serves concurrent calls from the cached import', async () => {
  await withWavFile(async (wav) => {
    const [first, second] = await Promise.all([fileDuration(wav), fileDuration(wav)]);

    assert.equal(first, second);
    assert.ok(Number.isInteger(first));
  });
});
