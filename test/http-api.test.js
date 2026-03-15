'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const requireDirPath = require.resolve('../lib/helpers/require-dir');
const httpApiPath = require.resolve('../lib/sonos-http-api');

function installRequireDirStub() {
  const original = require.cache[requireDirPath];

  function simplifyPlayer(player) {
    return {
      uuid: player.uuid,
      state: player.state,
      roomName: player.roomName,
      coordinator: player.coordinator.uuid
    };
  }

  require.cache[requireDirPath] = {
    id: requireDirPath,
    filename: requireDirPath,
    loaded: true,
    exports(cwd, cb) {
      cb((api) => {
        api.registerAction('zones', (player) => Promise.resolve(player.system.zones.map((zone) => ({
          uuid: zone.uuid,
          coordinator: simplifyPlayer(zone.coordinator),
          members: zone.members.map(simplifyPlayer)
        }))));
        api.registerAction('state', (player) => Promise.resolve(player.state));
        api.registerAction('volume', (player, values) => Promise.resolve({
          applied: player.setVolume(values[0])
        }));
        api.registerAction('ping', (player, values) => Promise.resolve({
          room: player.roomName,
          values
        }));
      });
    }
  };

  delete require.cache[httpApiPath];

  return () => {
    delete require.cache[httpApiPath];
    if (original) {
      require.cache[requireDirPath] = original;
      return;
    }

    delete require.cache[requireDirPath];
  };
}

function installActualActionsStub(actionModulePaths) {
  const original = require.cache[requireDirPath];

  require.cache[requireDirPath] = {
    id: requireDirPath,
    filename: requireDirPath,
    loaded: true,
    exports(cwd, cb) {
      actionModulePaths.forEach((modulePath) => {
        cb(require(modulePath));
      });
    }
  };

  delete require.cache[httpApiPath];

  return () => {
    delete require.cache[httpApiPath];
    if (original) {
      require.cache[requireDirPath] = original;
      return;
    }

    delete require.cache[requireDirPath];
  };
}

function createPlayer(roomName) {
  const coordinator = { uuid: `${roomName}-uuid` };

  return {
    roomName,
    uuid: `${roomName}-uuid`,
    coordinator,
    state: {
      roomName,
      mute: false,
      playbackState: 'PLAYING',
      equalizer: {
        bass: 0,
        treble: 0,
        nightMode: false,
        speechEnhancement: false
      }
    },
    mute() {
      this.state.mute = true;
      return Promise.resolve({ status: 'success' });
    },
    unMute() {
      this.state.mute = false;
      return Promise.resolve({ status: 'success' });
    },
    setBass(value) {
      this.state.equalizer.bass = value;
      return Promise.resolve({ status: 'success', bass: value });
    },
    setTreble(value) {
      this.state.equalizer.treble = value;
      return Promise.resolve({ status: 'success', treble: value });
    },
    setAVTransport(uri) {
      this.avTransportUri = uri;
      return Promise.resolve({ status: 'success' });
    },
    becomeCoordinatorOfStandaloneGroup() {
      return Promise.resolve({ status: 'success' });
    },
    setVolume(value) {
      return `volume:${value}`;
    },
    system: {
      zones: []
    }
  };
}

function createDiscovery() {
  const discovery = new EventEmitter();
  const livingRoom = createPlayer('Living Room');
  const kitchen = createPlayer('Kitchen');

  livingRoom.coordinator = livingRoom;
  kitchen.coordinator = kitchen;

  livingRoom.pauseCalled = 0;
  livingRoom.playCalled = 0;
  livingRoom.queueArgs = null;
  livingRoom.playlistName = null;
  livingRoom.favoriteName = null;
  livingRoom.queueResponse = [{
    title: 'Track 1',
    artist: 'Artist 1',
    album: 'Album 1',
    albumArtUri: '/art/1',
    uri: 'uri:1'
  }];
  livingRoom.pause = function pause() {
    this.pauseCalled += 1;
    this.state.playbackState = 'PAUSED_PLAYBACK';
    return Promise.resolve({ status: 'success' });
  };
  livingRoom.play = function play() {
    this.playCalled += 1;
    this.state.playbackState = 'PLAYING';
    return Promise.resolve({ status: 'success' });
  };
  livingRoom.replaceWithPlaylist = function replaceWithPlaylist(name) {
    this.playlistName = name;
    return Promise.resolve();
  };
  livingRoom.replaceWithFavorite = function replaceWithFavorite(name) {
    this.favoriteName = name;
    return Promise.resolve();
  };
  livingRoom.getQueue = function getQueue(limit, offset) {
    this.queueArgs = { limit, offset };
    return Promise.resolve(this.queueResponse);
  };

  const zones = [{
    uuid: 'zone-1',
    coordinator: livingRoom,
    members: [livingRoom, kitchen]
  }];

  livingRoom.system.zones = zones;
  kitchen.system.zones = zones;
  livingRoom.system.getPlayer = (name) => [livingRoom, kitchen].find((player) => player.roomName.toLowerCase() === name.toLowerCase());
  kitchen.system.getPlayer = livingRoom.system.getPlayer;
  livingRoom.system.getFavorites = () => Promise.resolve([
    { title: 'Morning Mix', uri: 'fav:1', metadata: 'meta-1' },
    { title: 'Evening Mix', uri: 'fav:2', metadata: 'meta-2' }
  ]);
  kitchen.system.getFavorites = livingRoom.system.getFavorites;

  discovery.zones = zones;
  discovery.getPlayer = (name) => [livingRoom, kitchen].find((player) => player.roomName.toLowerCase() === name.toLowerCase());
  discovery.getAnyPlayer = () => livingRoom;

  return { discovery, livingRoom };
}

function createRequest(url, method = 'GET') {
  const req = new EventEmitter();
  req.url = url;
  req.method = method;
  req.headers = {};
  return req;
}

function createResponse() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.headers = {};
  res.body = '';
  res.finished = false;

  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };

  res.getHeader = (name) => res.headers[name.toLowerCase()];

  res.write = (chunk) => {
    res.body += chunk.toString();
  };

  res.end = (chunk = '') => {
    if (chunk) {
      res.write(chunk);
    }
    res.finished = true;
    res.emit('finish');
  };

  return res;
}

async function invokeRequest(api, url, { waitForEnd = true } = {}) {
  const req = createRequest(url);
  const res = createResponse();

  api.requestHandler(req, res);

  if (waitForEnd && !res.finished) {
    await EventEmitter.once(res, 'finish');
  } else {
    await new Promise((resolve) => setImmediate(resolve));
  }

  return res;
}

test('routes room-specific actions and preserves response shape', async () => {
  const restore = installRequireDirStub();
  const { discovery } = createDiscovery();
  const HttpAPI = require('../lib/sonos-http-api');
  const api = new HttpAPI(discovery, { port: 5005 });

  const res = await invokeRequest(api, '/Living%20Room/volume/15');

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { applied: 'volume:15' });
  assert.equal(res.getHeader('content-type'), 'application/json;charset=utf-8');

  restore();
});

test('falls back to any player for global actions like /zones', async () => {
  const restore = installRequireDirStub();
  const { discovery } = createDiscovery();
  const HttpAPI = require('../lib/sonos-http-api');
  const api = new HttpAPI(discovery, { port: 5005 });

  const res = await invokeRequest(api, '/zones');
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(body.length, 1);
  assert.equal(body[0].coordinator.roomName, 'Living Room');

  restore();
});

test('keeps /events available as server-sent events endpoint', async () => {
  const restore = installRequireDirStub();
  const { discovery } = createDiscovery();
  const HttpAPI = require('../lib/sonos-http-api');
  const api = new HttpAPI(discovery, { port: 5005 });

  const res = await invokeRequest(api, '/events', { waitForEnd: false });

  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('content-type'), 'text/event-stream');
  assert.equal(res.finished, false);

  restore();
});

test('returns an error when no Sonos system has been discovered yet', async () => {
  const restore = installRequireDirStub();
  const discovery = new EventEmitter();
  discovery.zones = [];
  discovery.getPlayer = () => null;
  discovery.getAnyPlayer = () => null;

  const HttpAPI = require('../lib/sonos-http-api');
  const api = new HttpAPI(discovery, { port: 5005 });

  const res = await invokeRequest(api, '/zones');
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 500);
  assert.equal(body.status, 'error');
  assert.match(body.error, /No system has yet been discovered/);

  restore();
});

test('handles malformed URI components without crashing', async () => {
  const restore = installRequireDirStub();
  const { discovery } = createDiscovery();
  const HttpAPI = require('../lib/sonos-http-api');
  const api = new HttpAPI(discovery, { port: 5005 });

  const res = await invokeRequest(api, '/Living%ZZ/state');
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 500);
  assert.equal(body.status, 'error');
  assert.match(body.error, /URI malformed/);

  restore();
});

test('returns an empty response for /favicon.ico', async () => {
  const restore = installRequireDirStub();
  const { discovery } = createDiscovery();
  const HttpAPI = require('../lib/sonos-http-api');
  const api = new HttpAPI(discovery, { port: 5005 });

  const res = await invokeRequest(api, '/favicon.ico');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '');

  restore();
});

test('returns a stable JSON error for unknown actions', async () => {
  const restore = installRequireDirStub();
  const { discovery } = createDiscovery();
  const HttpAPI = require('../lib/sonos-http-api');
  const api = new HttpAPI(discovery, { port: 5005 });

  const res = await invokeRequest(api, '/Living%20Room/not-a-real-action');
  const body = JSON.parse(res.body);

  assert.equal(res.statusCode, 500);
  assert.equal(body.status, 'error');
  assert.match(body.error, /action 'not-a-real-action' not found/);

  restore();
});

test('routes real action modules for playpause, mute, equalizer, queue and join', async () => {
  const restore = installActualActionsStub([
    require.resolve('../lib/actions/playpause'),
    require.resolve('../lib/actions/mute'),
    require.resolve('../lib/actions/equalizer'),
    require.resolve('../lib/actions/queue'),
    require.resolve('../lib/actions/group')
  ]);
  const { discovery, livingRoom } = createDiscovery();
  const HttpAPI = require('../lib/sonos-http-api');
  const api = new HttpAPI(discovery, { port: 5005 });

  const playpauseRes = await invokeRequest(api, '/Living%20Room/playpause');
  assert.equal(playpauseRes.statusCode, 200);
  assert.deepEqual(JSON.parse(playpauseRes.body), { status: 'success', paused: true });
  assert.equal(livingRoom.pauseCalled, 1);

  const toggleMuteRes = await invokeRequest(api, '/Living%20Room/togglemute');
  assert.equal(toggleMuteRes.statusCode, 200);
  assert.deepEqual(JSON.parse(toggleMuteRes.body), { status: 'success', muted: true });
  assert.equal(livingRoom.state.mute, true);

  const bassRes = await invokeRequest(api, '/Living%20Room/bass/4');
  assert.equal(bassRes.statusCode, 200);
  assert.deepEqual(JSON.parse(bassRes.body), { status: 'success', bass: 4 });
  assert.equal(livingRoom.state.equalizer.bass, 4);

  const queueRes = await invokeRequest(api, '/Living%20Room/queue/10/detailed');
  assert.equal(queueRes.statusCode, 200);
  assert.deepEqual(JSON.parse(queueRes.body), livingRoom.queueResponse);
  assert.deepEqual(livingRoom.queueArgs, { limit: 10, offset: undefined });

  const joinRes = await invokeRequest(api, '/Living%20Room/join/Kitchen');
  assert.equal(joinRes.statusCode, 200);
  assert.deepEqual(JSON.parse(joinRes.body), { status: 'success' });
  assert.equal(livingRoom.avTransportUri, 'x-rincon:Kitchen-uuid');

  restore();
});

test('routes playlist, favorite and favorites endpoints with stable response shapes', async () => {
  const restore = installActualActionsStub([
    require.resolve('../lib/actions/playlist'),
    require.resolve('../lib/actions/favorite'),
    require.resolve('../lib/actions/favorites')
  ]);
  const { discovery, livingRoom } = createDiscovery();
  const HttpAPI = require('../lib/sonos-http-api');
  const api = new HttpAPI(discovery, { port: 5005 });

  const playlistRes = await invokeRequest(api, '/Living%20Room/playlist/Road%20Trip');
  assert.equal(playlistRes.statusCode, 200);
  assert.deepEqual(JSON.parse(playlistRes.body), { status: 'success' });
  assert.equal(livingRoom.playlistName, 'Road Trip');
  assert.equal(livingRoom.playCalled, 1);

  const favoriteRes = await invokeRequest(api, '/Living%20Room/favorite/BBC%20Radio%206');
  assert.equal(favoriteRes.statusCode, 200);
  assert.deepEqual(JSON.parse(favoriteRes.body), { status: 'success' });
  assert.equal(livingRoom.favoriteName, 'BBC Radio 6');
  assert.equal(livingRoom.playCalled, 2);

  const favouritesRes = await invokeRequest(api, '/Living%20Room/favourites');
  assert.equal(favouritesRes.statusCode, 200);
  assert.deepEqual(JSON.parse(favouritesRes.body), ['Morning Mix', 'Evening Mix']);

  const detailedRes = await invokeRequest(api, '/Living%20Room/favorites/detailed');
  assert.equal(detailedRes.statusCode, 200);
  assert.deepEqual(JSON.parse(detailedRes.body), [
    { title: 'Morning Mix', uri: 'fav:1', metadata: 'meta-1' },
    { title: 'Evening Mix', uri: 'fav:2', metadata: 'meta-2' }
  ]);

  restore();
});
