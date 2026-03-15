'use strict';
const LIST_TYPE = require('../../types/list-type');

function getPlaylists() {
  return this._getCachedList(LIST_TYPE.SAVED_QUEUES, () => {
    return this.getAnyPlayer().browseAll('SQ:');
  });
}

module.exports = getPlaylists;
