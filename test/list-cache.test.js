'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const listCache = require('../vendor/sonos-discovery/lib/helpers/list-cache');
const getFavorites = require('../vendor/sonos-discovery/lib/prototypes/SonosSystem/getFavorites');
const getPlaylists = require('../vendor/sonos-discovery/lib/prototypes/SonosSystem/getPlaylists');
const LIST_TYPE = require('../vendor/sonos-discovery/lib/types/list-type');

function createSystemWithBrowseStub(browseImpl) {
  const system = {
    _getCachedList: listCache.getCachedList,
    _invalidateListCache: listCache.invalidateListCache,
    getFavorites,
    getPlaylists
  };
  system._listCache = Object.create(null);
  system._listCacheInflight = Object.create(null);
  system.getAnyPlayer = () => ({
    browseAll: browseImpl
  });
  return system;
}

test('favorites cache reuses the first loaded result and deduplicates concurrent requests', async () => {
  let callCount = 0;
  let releaseBrowse;
  const firstResult = [{ title: 'Morning Mix' }];
  const browsePromise = new Promise((resolve) => {
    releaseBrowse = () => resolve(firstResult);
  });

  const system = createSystemWithBrowseStub((objectId) => {
    callCount += 1;
    assert.equal(objectId, 'FV:2');
    return browsePromise;
  });

  const firstRequest = system.getFavorites();
  const secondRequest = system.getFavorites();

  await Promise.resolve();
  assert.equal(callCount, 1);

  releaseBrowse();

  const [firstResponse, secondResponse] = await Promise.all([firstRequest, secondRequest]);
  assert.strictEqual(firstResponse, firstResult);
  assert.strictEqual(secondResponse, firstResult);

  const cachedResponse = await system.getFavorites();
  assert.strictEqual(cachedResponse, firstResult);
  assert.equal(callCount, 1);
});

test('favorites and playlists caches are invalidated independently', async () => {
  let favoritesCallCount = 0;
  let playlistsCallCount = 0;
  let favoritesResult = [{ title: 'Morning Mix' }];
  let playlistsResult = [{ title: 'Road Trip' }];

  const system = {
    _getCachedList: listCache.getCachedList,
    _invalidateListCache: listCache.invalidateListCache,
    getFavorites,
    getPlaylists
  };
  system._listCache = Object.create(null);
  system._listCacheInflight = Object.create(null);
  system.getAnyPlayer = () => ({
    browseAll(objectId) {
      if (objectId === 'FV:2') {
        favoritesCallCount += 1;
        return Promise.resolve(favoritesResult);
      }

      if (objectId === 'SQ:') {
        playlistsCallCount += 1;
        return Promise.resolve(playlistsResult);
      }

      throw new Error(`Unexpected objectId ${objectId}`);
    }
  });

  await system.getFavorites();
  await system.getPlaylists();
  assert.equal(favoritesCallCount, 1);
  assert.equal(playlistsCallCount, 1);

  system._invalidateListCache(LIST_TYPE.FAVORITES);
  favoritesResult = [{ title: 'Updated Morning Mix' }];

  const refreshedFavorites = await system.getFavorites();
  const cachedPlaylists = await system.getPlaylists();

  assert.deepEqual(refreshedFavorites, [{ title: 'Updated Morning Mix' }]);
  assert.strictEqual(cachedPlaylists, playlistsResult);
  assert.equal(favoritesCallCount, 2);
  assert.equal(playlistsCallCount, 1);

  system._invalidateListCache(LIST_TYPE.SAVED_QUEUES);
  playlistsResult = [{ title: 'Updated Road Trip' }];

  const refreshedPlaylists = await system.getPlaylists();
  assert.deepEqual(refreshedPlaylists, [{ title: 'Updated Road Trip' }]);
  assert.equal(playlistsCallCount, 2);
});

test('favorites cache clears inflight state after loader failures so retries can recover', async () => {
  let callCount = 0;
  const transientError = new Error('Temporary browse failure');
  const favoritesResult = [{ title: 'Recovered Mix' }];

  const system = createSystemWithBrowseStub((objectId) => {
    callCount += 1;
    assert.equal(objectId, 'FV:2');

    if (callCount === 1) {
      return Promise.reject(transientError);
    }

    return Promise.resolve(favoritesResult);
  });

  const firstRequest = system.getFavorites();
  const secondRequest = system.getFavorites();

  await assert.rejects(firstRequest, transientError);
  await assert.rejects(secondRequest, transientError);
  assert.equal(callCount, 1);
  assert.equal(system._listCacheInflight[LIST_TYPE.FAVORITES], undefined);
  assert.equal(system._listCache[LIST_TYPE.FAVORITES], undefined);

  const recovered = await system.getFavorites();
  assert.strictEqual(recovered, favoritesResult);
  assert.equal(callCount, 2);
  assert.strictEqual(system._listCache[LIST_TYPE.FAVORITES], favoritesResult);
});

test('invalidating without a list type clears all cached lists and inflight loads', async () => {
  let favoritesCallCount = 0;
  let playlistsCallCount = 0;

  const system = createSystemWithBrowseStub((objectId) => {
    if (objectId === 'FV:2') {
      favoritesCallCount += 1;
      return Promise.resolve([{ title: `Favorites ${favoritesCallCount}` }]);
    }

    if (objectId === 'SQ:') {
      playlistsCallCount += 1;
      return Promise.resolve([{ title: `Playlists ${playlistsCallCount}` }]);
    }

    throw new Error(`Unexpected objectId ${objectId}`);
  });

  await system.getFavorites();
  await system.getPlaylists();
  assert.equal(favoritesCallCount, 1);
  assert.equal(playlistsCallCount, 1);

  system._invalidateListCache();

  assert.deepEqual(system._listCache, Object.create(null));
  assert.deepEqual(system._listCacheInflight, Object.create(null));

  await system.getFavorites();
  await system.getPlaylists();
  assert.equal(favoritesCallCount, 2);
  assert.equal(playlistsCallCount, 2);
});

test('cached list helper recreates cache containers when older instances lack them', async () => {
  let callCount = 0;
  const system = {
    _getCachedList: listCache.getCachedList,
    getAnyPlayer() {
      return {
        browseAll() {
          callCount += 1;
          return Promise.resolve([{ title: 'Fresh cache' }]);
        }
      };
    }
  };

  const result = await getFavorites.call(system);

  assert.deepEqual(result, [{ title: 'Fresh cache' }]);
  assert.equal(callCount, 1);
  assert.ok(system._listCache);
  assert.ok(system._listCacheInflight);
  assert.strictEqual(system._listCache[LIST_TYPE.FAVORITES], result);
});
