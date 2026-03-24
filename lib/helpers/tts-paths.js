'use strict';
const path = require('path');

const TTS_ROUTE_PREFIX = '/tts';

function getDefaultTtsDir(settings) {
  return path.join(settings.webroot, 'tts');
}

function getTtsDir(settings) {
  if (settings.ttsDir) {
    return path.resolve(settings.ttsDir);
  }

  return getDefaultTtsDir(settings);
}

function getTtsFilePath(settings, filename) {
  return path.join(getTtsDir(settings), filename);
}

function getTtsUri(filename) {
  return `${TTS_ROUTE_PREFIX}/${filename}`;
}

module.exports = {
  TTS_ROUTE_PREFIX,
  getDefaultTtsDir,
  getTtsDir,
  getTtsFilePath,
  getTtsUri
};
