'use strict';

function invalidateListCache(type) {
  if (!type) {
    this._listCache = Object.create(null);
    this._listCacheInflight = Object.create(null);
    return;
  }

  delete this._listCache[type];
  delete this._listCacheInflight[type];
}

function getCachedList(type, loader) {
  if (!this._listCache) {
    this._listCache = Object.create(null);
  }

  if (!this._listCacheInflight) {
    this._listCacheInflight = Object.create(null);
  }

  if (this._listCache[type]) {
    return Promise.resolve(this._listCache[type]);
  }

  if (this._listCacheInflight[type]) {
    return this._listCacheInflight[type];
  }

  const loadPromise = Promise.resolve()
    .then(loader)
    .then((items) => {
      this._listCache[type] = items;
      delete this._listCacheInflight[type];
      return items;
    })
    .catch((error) => {
      delete this._listCacheInflight[type];
      throw error;
    });

  this._listCacheInflight[type] = loadPromise;
  return loadPromise;
}

module.exports = {
  invalidateListCache,
  getCachedList
};
