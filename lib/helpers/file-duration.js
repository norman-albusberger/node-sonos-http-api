// music-metadata is ESM-only since v8: its package.json "exports" offers
// "import"/"module-sync"/"types" but no "require" condition and no CJS default.
// A top-level require() therefore throws ERR_PACKAGE_PATH_NOT_EXPORTED and kills
// the process before server.js can listen. Node 22.x does not enable
// require(esm) by default either, so "module-sync" does not rescue it.
//
// Load it through a dynamic import() instead and cache the promise so the module
// is evaluated only once. This module stays CommonJS and its public signature is
// unchanged: fileDuration(path) -> Promise<number> (milliseconds).
//
// Do NOT convert this back to require('music-metadata').
let musicMetaPromise;

function fileDuration(path) {
  if (!musicMetaPromise) {
    musicMetaPromise = import('music-metadata');
  }

  return musicMetaPromise
      .then((musicMeta) => musicMeta.parseFile(path, { duration: true }))
      .then((info) => Math.ceil(info.format.duration * 1000));
}

module.exports = fileDuration;
