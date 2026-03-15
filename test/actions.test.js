'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadActions(registerModule) {
  const actions = new Map();
  registerModule({
    registerAction(name, handler) {
      actions.set(name, handler);
    }
  });
  return actions;
}

test('playpause pauses an already playing coordinator', async () => {
  const actions = loadActions(require('../lib/actions/playpause'));
  let pauseCalled = false;

  const player = {
    coordinator: {
      state: { playbackState: 'PLAYING' },
      pause() {
        pauseCalled = true;
        return Promise.resolve();
      }
    }
  };

  const result = await actions.get('playpause')(player);

  assert.equal(pauseCalled, true);
  assert.deepEqual(result, { status: 'success', paused: true });
});

test('playpause plays a stopped coordinator', async () => {
  const actions = loadActions(require('../lib/actions/playpause'));
  let playCalled = false;

  const player = {
    coordinator: {
      state: { playbackState: 'STOPPED' },
      play() {
        playCalled = true;
        return Promise.resolve();
      }
    }
  };

  const result = await actions.get('playpause')(player);

  assert.equal(playCalled, true);
  assert.deepEqual(result, { status: 'success', paused: false });
});

test('togglemute mutes and unmutes based on current state', async () => {
  const actions = loadActions(require('../lib/actions/mute'));
  let muted = false;
  let unmuted = false;

  const player = {
    state: { mute: false },
    mute() {
      muted = true;
      return Promise.resolve();
    },
    unMute() {
      unmuted = true;
      return Promise.resolve();
    }
  };

  const muteResult = await actions.get('togglemute')(player);
  assert.equal(muted, true);
  assert.deepEqual(muteResult, { status: 'success', muted: true });

  player.state.mute = true;
  const unmuteResult = await actions.get('togglemute')(player);
  assert.equal(unmuted, true);
  assert.deepEqual(unmuteResult, { status: 'success', muted: false });
});

test('queue simplifies queue items unless detailed was requested', async () => {
  const actions = loadActions(require('../lib/actions/queue'));
  const queueItems = [{
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    albumArtUri: '/art',
    uri: 'x-sonos-http:song'
  }];

  const player = {
    coordinator: {
      getQueue(limit, offset) {
        assert.equal(limit, 10);
        assert.equal(offset, 5);
        return Promise.resolve(queueItems);
      }
    }
  };

  const result = await actions.get('queue')(player, ['10', '5']);
  assert.deepEqual(result, [{
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    albumArtUri: '/art'
  }]);

  const detailedPlayer = {
    coordinator: {
      getQueue(limit, offset) {
        assert.equal(limit, 10);
        assert.equal(offset, undefined);
        return Promise.resolve(queueItems);
      }
    }
  };

  const detailed = await actions.get('queue')(detailedPlayer, ['10', 'detailed']);
  assert.deepEqual(detailed, queueItems);
});

test('bass and treble parse numeric values before delegating', async () => {
  const actions = loadActions(require('../lib/actions/equalizer'));
  let bassValue;
  let trebleValue;

  const player = {
    setBass(value) {
      bassValue = value;
      return Promise.resolve({ status: 'success' });
    },
    setTreble(value) {
      trebleValue = value;
      return Promise.resolve({ status: 'success' });
    }
  };

  await actions.get('bass')(player, ['3']);
  await actions.get('treble')(player, ['-2']);

  assert.equal(bassValue, 3);
  assert.equal(trebleValue, -2);
});

test('join rejects unknown target rooms with a descriptive error', async () => {
  const groupActions = require('../lib/actions/group');
  const player = {
    roomName: 'Office',
    system: {
      getPlayer() {
        return null;
      }
    }
  };

  await assert.rejects(
    groupActions.joinPlayer(player, ['Kitchen']),
    /Room Kitchen not found - can't make Office join it/
  );
});

test('playlist replaces the queue with the requested playlist and starts playback', async () => {
  const actions = loadActions(require('../lib/actions/playlist'));
  let playlistName;
  let playCalled = false;

  const player = {
    coordinator: {
      replaceWithPlaylist(name) {
        playlistName = name;
        return Promise.resolve();
      },
      play() {
        playCalled = true;
        return Promise.resolve({ status: 'success' });
      }
    }
  };

  const result = await actions.get('playlist')(player, ['Road%20Trip']);

  assert.equal(playlistName, 'Road Trip');
  assert.equal(playCalled, true);
  assert.deepEqual(result, { status: 'success' });
});

test('favorite and favourite replace playback with the requested favorite and start playback', async () => {
  const actions = loadActions(require('../lib/actions/favorite'));
  const requestedFavorites = [];
  let playCalled = 0;

  const player = {
    coordinator: {
      replaceWithFavorite(name) {
        requestedFavorites.push(name);
        return Promise.resolve();
      },
      play() {
        playCalled += 1;
        return Promise.resolve({ status: 'success' });
      }
    }
  };

  const favoriteResult = await actions.get('favorite')(player, ['BBC%20Radio%206']);
  const favouriteResult = await actions.get('favourite')(player, ['BBC%20Radio%206']);

  assert.deepEqual(requestedFavorites, ['BBC Radio 6', 'BBC Radio 6']);
  assert.equal(playCalled, 2);
  assert.deepEqual(favoriteResult, { status: 'success' });
  assert.deepEqual(favouriteResult, { status: 'success' });
});

test('favorites returns titles by default and full objects in detailed mode', async () => {
  const actions = loadActions(require('../lib/actions/favorites'));
  const favorites = [
    { title: 'Morning Mix', uri: 'fav:1', metadata: 'meta-1' },
    { title: 'Evening Mix', uri: 'fav:2', metadata: 'meta-2' }
  ];

  const player = {
    system: {
      getFavorites() {
        return Promise.resolve(favorites);
      }
    }
  };

  const titles = await actions.get('favorites')(player, []);
  const detailed = await actions.get('favorites')(player, ['detailed']);
  const favouritesAlias = await actions.get('favourites')(player, []);

  assert.deepEqual(titles, ['Morning Mix', 'Evening Mix']);
  assert.deepEqual(detailed, favorites);
  assert.deepEqual(favouritesAlias, ['Morning Mix', 'Evening Mix']);
});

test('musicsearch rejects unsupported services and types', async () => {
  const actions = loadActions(require('../lib/actions/musicSearch'));
  const player = {
    coordinator: { uuid: 'uuid-1' }
  };

  await assert.rejects(actions.get('musicsearch')(player, ['invalid', 'song', 'term']), /Invalid music service/);
  await assert.rejects(actions.get('musicsearch')(player, ['library', 'invalid', 'term']), /Invalid type invalid/);
});

test('musicsearch delegates library load requests immediately', async () => {
  const libraryDef = require('../lib/music_services/libraryDef');
  const originalLoad = libraryDef.load;
  const originalNoLib = libraryDef.nolib;
  let loadCalled = false;

  libraryDef.load = () => {
    loadCalled = true;
    return Promise.resolve('Library and search loaded');
  };
  libraryDef.nolib = () => false;

  try {
    const actions = loadActions(require('../lib/actions/musicSearch'));
    const player = {
      coordinator: { uuid: 'uuid-1' }
    };

    const result = await actions.get('musicsearch')(player, ['library', 'load', 'term']);
    assert.equal(loadCalled, true);
    assert.equal(result, 'Library and search loaded');
  } finally {
    libraryDef.load = originalLoad;
    libraryDef.nolib = originalNoLib;
  }
});

test('debug exposes TTS runtime info for docs and diagnostics', async () => {
  const actions = loadActions(require('../lib/actions/debug'));

  const player = {
    system: {
      localEndpoint: '127.0.0.1',
      availableServices: [],
      players: []
    }
  };

  const result = await actions.get('debug')(player, ['tts']);

  assert.equal(result.announceVolume, 40);
  assert.equal(result.endpoints.say, '/{room}/say/{text}[/{voiceOrLanguageOrVolume}][/{volume}]');
  assert.deepEqual(result.providerResolutionOrder, [
    'aws-polly',
    'elevenlabs',
    'mac-os',
    'microsoft',
    'voicerss',
    'google'
  ]);
  assert.ok(result.activeProviders.length >= 1);
  assert.ok(result.activeProviders.some((provider) => provider.id === 'google'));
  assert.equal(result.preferredProvider.id, result.activeProviders[0].id);
});
