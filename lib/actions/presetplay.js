/**
 * presetplay.js
 *
 * Plays a Sonos Favorite or Playlist on a predefined preset configuration.
 * Allows triggering grouped playback scenes with a specific source using url parameters.
 *
 * Usage:
 *   /presetplay/:preset/:source
 *   /presetplay/:preset/:source/:type
 *
 * Example:
 *   /presetplay/livingroom/Radio%20Paradise
 *   /presetplay/livingroom/Weekend%20Hits/plist
 *
 * Author: Norman Albusberger
 * Description: Registers the 'presetplay' action for node-sonos-http-api,
 *              enabling the playback of a Sonos Favorite or Playlist using a preset group.
 */
'use strict';

const settings = require('../../settings');
const presets = require('../presets-loader');
const logger = require('sonos-discovery/lib/helpers/logger');



function playPresetSource(player, values) {
    const value = decodeURIComponent(values[0]);
    const sourceName = decodeURIComponent(values[1]);
    const type = (values[2] || 'fav').toLowerCase(); // default is favorite

    if (!value || !sourceName) {
        return Promise.reject('Required params are missing: Preset and Source.');
    }

    let preset;

    if (value.startsWith('{')) {
        try {
            preset = JSON.parse(value);
        } catch (err) {
            return Promise.reject('Could not parse preset JSON: ' + err.message);
        }
    } else {
        preset = presets[value];
    }

    if (!preset) {
        logger.warn(`Preset '${value}' not found.`);
        return Promise.reject(`Preset '${value}' not found.`);
    }

    return player.system.applyPreset(preset)
        .then(() => {
            const coordinatorName = preset.players?.[0]?.roomName;
            const coordinator = player.system.getPlayer(coordinatorName);
            if (!coordinator) {
                throw new Error(`Coordinator '${coordinatorName}' not found in system.`);
            }
            if (type === 'plist') {
                return coordinator.replaceWithPlaylist(sourceName)
                    .then(() => coordinator.play());
            } else {
                return coordinator.replaceWithFavorite(sourceName)
                    .then(() => coordinator.play());
            }
        })
        .catch(err => {
            logger.error(`Fehler bei presetplay für Preset '${value}', Quelle '${sourceName}', Typ '${type}':`, err);
            throw err;
        });
}

module.exports = function (api) {
    if (settings.license?.key) {
        // Register two endpoints: /presetplay/:preset/:source and /presetplay/:preset/:source/:type
        api.registerAction('presetplay', playPresetSource);
    }

};