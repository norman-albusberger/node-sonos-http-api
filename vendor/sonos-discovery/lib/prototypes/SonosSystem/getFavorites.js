'use strict';
const LIST_TYPE = require('../../types/list-type');

function getFavorites() {
  return this._getCachedList(LIST_TYPE.FAVORITES, () => {
    return this.getAnyPlayer().browseAll('FV:2');
  });
}

module.exports = getFavorites;
