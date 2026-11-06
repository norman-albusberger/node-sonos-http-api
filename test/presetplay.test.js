'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// presetplay -> presets-loader -> settings. All three are re-required against a
// throwaway settings.json, so the result never depends on a settings.json that
// happens to sit in the checkout. Nothing here talks to a Sonos system: the
// player passed to the handler is a fake that only records calls.
const modulePaths = [
  require.resolve('../settings'),
  require.resolve('../lib/presets-loader'),
  require.resolve('../lib/actions/presetplay')
];

function clearModules() {
  modulePaths.forEach((modulePath) => {
    delete require.cache[modulePath];
  });
}

function loadPresetplay(settingsObject, presetFiles = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonos-http-api-presetplay-'));
  const presetDir = path.join(tempRoot, 'presets');
  const settingsFile = path.join(tempRoot, 'settings.json');
  const previousSettingsPath = process.env.SETTINGS_PATH;

  fs.mkdirSync(presetDir);
  Object.entries(presetFiles).forEach(([name, preset]) => {
    fs.writeFileSync(path.join(presetDir, `${name}.json`), JSON.stringify(preset));
  });
  fs.writeFileSync(settingsFile, JSON.stringify({
    webroot: path.join(tempRoot, 'static'),
    cacheDir: path.join(tempRoot, 'cache'),
    presetDir,
    ...settingsObject
  }));

  function cleanup() {
    clearModules();
    if (previousSettingsPath === undefined) {
      delete process.env.SETTINGS_PATH;
    } else {
      process.env.SETTINGS_PATH = previousSettingsPath;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  clearModules();
  process.env.SETTINGS_PATH = settingsFile;

  try {
    const actions = new Map();
    require('../lib/actions/presetplay')({
      registerAction(name, handler) {
        actions.set(name, handler);
      }
    });
    return { actions, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

function createFakePlayer() {
  const calls = [];
  const coordinator = {
    replaceWithFavorite(name) {
      calls.push(['replaceWithFavorite', name]);
      return Promise.resolve();
    },
    replaceWithPlaylist(name) {
      calls.push(['replaceWithPlaylist', name]);
      return Promise.resolve();
    },
    play() {
      calls.push(['play']);
      return Promise.resolve({ status: 'success' });
    }
  };

  return {
    calls,
    player: {
      system: {
        applyPreset(preset) {
          calls.push(['applyPreset', preset]);
          return Promise.resolve();
        },
        getPlayer(roomName) {
          calls.push(['getPlayer', roomName]);
          return coordinator;
        }
      }
    }
  };
}

test('presetplay is registered when settings carry no license key (SonoX appliance)', () => {
  const loader = loadPresetplay({});

  try {
    assert.equal(require('../settings').license, undefined);
    assert.equal(typeof loader.actions.get('presetplay'), 'function');
  } finally {
    loader.cleanup();
  }
});

test('presetplay is still registered when settings carry a license key (SonoX-Pro)', () => {
  const loader = loadPresetplay({ license: { key: 'any-key' } });

  try {
    assert.equal(typeof loader.actions.get('presetplay'), 'function');
  } finally {
    loader.cleanup();
  }
});

test('presetplay keeps both URL forms: favorite by default, playlist with /plist', async () => {
  const livingroom = { players: [{ roomName: 'Living Room', volume: 20 }] };
  const loader = loadPresetplay({}, { livingroom });

  try {
    const handler = loader.actions.get('presetplay');

    // /presetplay/:preset/:source
    const favorite = createFakePlayer();
    await handler(favorite.player, ['livingroom', 'Radio%20Paradise']);
    assert.deepEqual(favorite.calls, [
      ['applyPreset', livingroom],
      ['getPlayer', 'Living Room'],
      ['replaceWithFavorite', 'Radio Paradise'],
      ['play']
    ]);

    // /presetplay/:preset/:source/:type, with an inline JSON preset
    const inline = { players: [{ roomName: 'Kitchen' }] };
    const playlist = createFakePlayer();
    await handler(playlist.player, [
      encodeURIComponent(JSON.stringify(inline)),
      'Weekend%20Hits',
      'plist'
    ]);
    assert.deepEqual(playlist.calls, [
      ['applyPreset', inline],
      ['getPlayer', 'Kitchen'],
      ['replaceWithPlaylist', 'Weekend Hits'],
      ['play']
    ]);

    // An unknown preset is rejected before anything reaches the system.
    const unknown = createFakePlayer();
    await assert.rejects(handler(unknown.player, ['nope', 'Radio']), /Preset 'nope' not found/);
    assert.deepEqual(unknown.calls, []);
  } finally {
    loader.cleanup();
  }
});
