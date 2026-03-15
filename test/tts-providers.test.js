'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pollyPath = require.resolve('../lib/tts-providers/aws-polly');
const settingsPath = require.resolve('../settings');
const fileDurationPath = require.resolve('../lib/helpers/file-duration');
const pollyClientPath = require.resolve('@aws-sdk/client-polly');

function loadPollyWithStubs({ settings, fileDuration, sendImpl }) {
  const originals = new Map();
  const trackedPaths = [settingsPath, fileDurationPath, pollyClientPath];
  const state = {
    clientConfig: null,
    commandInput: null,
    sendCalls: 0
  };

  for (const modulePath of trackedPaths) {
    originals.set(modulePath, require.cache[modulePath]);
  }

  require.cache[settingsPath] = {
    id: settingsPath,
    filename: settingsPath,
    loaded: true,
    exports: settings
  };

  require.cache[fileDurationPath] = {
    id: fileDurationPath,
    filename: fileDurationPath,
    loaded: true,
    exports: fileDuration
  };

  class PollyClient {
    constructor(config) {
      state.clientConfig = config;
    }

    send(command) {
      state.sendCalls += 1;
      state.commandInput = command.input;
      return sendImpl(command);
    }
  }

  class SynthesizeSpeechCommand {
    constructor(input) {
      this.input = input;
    }
  }

  require.cache[pollyClientPath] = {
    id: pollyClientPath,
    filename: pollyClientPath,
    loaded: true,
    exports: {
      PollyClient,
      SynthesizeSpeechCommand
    }
  };

  delete require.cache[pollyPath];

  return {
    polly: require('../lib/tts-providers/aws-polly'),
    state,
    restore() {
      delete require.cache[pollyPath];
      for (const modulePath of trackedPaths) {
        const original = originals.get(modulePath);
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }
    }
  };
}

test('aws polly synthesizes audio with the modular SDK client', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonos-http-api-polly-'));
  const ttsDir = path.join(tempRoot, 'tts');
  fs.mkdirSync(ttsDir, { recursive: true });

  const loader = loadPollyWithStubs({
    settings: {
      webroot: tempRoot,
      aws: {
        credentials: { region: 'eu-central-1' },
        name: 'Joanna'
      }
    },
    fileDuration: () => Promise.resolve(4321),
    sendImpl: () => Promise.resolve({
      AudioStream: {
        transformToByteArray: () => Promise.resolve(Uint8Array.from([1, 2, 3, 4]))
      }
    })
  });

  try {
    const result = await loader.polly('hello world', 'AmyNeural');

    assert.equal(loader.state.sendCalls, 1);
    assert.deepEqual(loader.state.clientConfig, { region: 'eu-central-1' });
    assert.equal(loader.state.commandInput.Text, 'hello world');
    assert.equal(loader.state.commandInput.Engine, 'neural');
    assert.equal(loader.state.commandInput.VoiceId, 'Amy');
    assert.equal(result.duration, 4321);
    assert.match(result.uri, /^\/tts\/polly-[a-f0-9]+-Amy\.mp3$/);
    assert.equal(fs.existsSync(path.join(tempRoot, result.uri)), true);
  } finally {
    loader.restore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('aws polly reuses an existing cached audio file', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonos-http-api-polly-cache-'));
  const ttsDir = path.join(tempRoot, 'tts');
  fs.mkdirSync(ttsDir, { recursive: true });
  const cachedFile = path.join(ttsDir, 'polly-aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d-Joanna.mp3');
  fs.writeFileSync(cachedFile, Buffer.from([9, 8, 7]));

  const loader = loadPollyWithStubs({
    settings: {
      webroot: tempRoot,
      aws: {
        credentials: { region: 'eu-central-1' },
        name: 'Joanna'
      }
    },
    fileDuration: () => Promise.resolve(987),
    sendImpl: () => {
      throw new Error('cached path should not synthesize');
    }
  });

  try {
    const result = await loader.polly('hello');

    assert.equal(loader.state.sendCalls, 0);
    assert.deepEqual(result, {
      duration: 987,
      uri: '/tts/polly-aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d-Joanna.mp3'
    });
  } finally {
    loader.restore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
