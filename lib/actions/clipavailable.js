'use strict';
const path = require('path');
const settings = require('../../settings');
const fileDuration = require('../helpers/file-duration');
const {available} = require('../helpers/all-player-announcement');


let port;

const LOCAL_PATH_LOCATION = path.join(settings.webroot, 'clips');

function playClipOnAvailable(player, values) {
    const clipFileName = values[0];
    let announceVolume = settings.announceVolume || 40;

    if (/^\d+$/i.test(values[1])) {
        // first parameter is volume
        announceVolume = values[1];
    }

    // Determine duration of the audio file
    return fileDuration(path.join(LOCAL_PATH_LOCATION, clipFileName))
        .then((duration) => {
            const uri = `http://${player.system.localEndpoint}:${port}/clips/${clipFileName}`;
            return available(player.system, uri, announceVolume, duration);
        });
}

module.exports = function (api) {
    port = api.getPort();
    api.registerAction('clipavailable', playClipOnAvailable);
};