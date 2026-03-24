'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const settingsModulePath = require.resolve('../settings');

function loadSettingsFromFile(settingsObject) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonos-http-api-settings-'));
  const settingsFile = path.join(tempRoot, 'settings.json');
  const previousSettingsPath = process.env.SETTINGS_PATH;

  fs.writeFileSync(settingsFile, JSON.stringify(settingsObject));
  delete require.cache[settingsModulePath];
  process.env.SETTINGS_PATH = settingsFile;

  try {
    return {
      settings: require('../settings'),
      cleanup() {
        delete require.cache[settingsModulePath];
        if (previousSettingsPath === undefined) {
          delete process.env.SETTINGS_PATH;
        } else {
          process.env.SETTINGS_PATH = previousSettingsPath;
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    };
  } catch (error) {
    delete require.cache[settingsModulePath];
    if (previousSettingsPath === undefined) {
      delete process.env.SETTINGS_PATH;
    } else {
      process.env.SETTINGS_PATH = previousSettingsPath;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

test('settings derive ttsDir from webroot when not configured', () => {
  const webroot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonos-http-api-webroot-'));
  const loader = loadSettingsFromFile({ webroot });

  try {
    assert.equal(loader.settings.ttsDir, path.join(webroot, 'tts'));
    assert.equal(fs.existsSync(loader.settings.ttsDir), true);
  } finally {
    loader.cleanup();
    fs.rmSync(webroot, { recursive: true, force: true });
  }
});

test('settings honor an explicit ttsDir outside webroot', () => {
  const webroot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonos-http-api-webroot-'));
  const externalTtsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sonos-http-api-tts-'));
  const configuredTtsDir = path.join(externalTtsRoot, 'generated');
  const loader = loadSettingsFromFile({ webroot, ttsDir: configuredTtsDir });

  try {
    assert.equal(loader.settings.ttsDir, configuredTtsDir);
    assert.equal(fs.existsSync(loader.settings.ttsDir), true);
    assert.notEqual(loader.settings.ttsDir, path.join(webroot, 'tts'));
  } finally {
    loader.cleanup();
    fs.rmSync(webroot, { recursive: true, force: true });
    fs.rmSync(externalTtsRoot, { recursive: true, force: true });
  }
});
