const axios = require('axios');
const logger = require('sonos-discovery/lib/helpers/logger');

let lastTrackPerZone = {};

function setupTextInputSync(discovery, settings) {
    const config = settings.textInputSync;
    const license = settings.license;

    console.log(settings.config)

    if (!license?.key || !config?.enabled) {
        logger.info('TextInputSync is disabled or no license key present.');
        return;
    }

    const protocol = config.use_ssl ? 'https' : 'http';
    const auth = Buffer.from(`${config.user}:${decodeURIComponent(config.pass)}`).toString('base64');
    const baseURL = `${protocol}://${config.host}:${config.port}`;

    discovery.on('transport-state', async (data) => {
        const normalizeRoomName = (name) =>
            name
              .normalize('NFD')                     // Zerlege Unicode-Zeichen
              .replace(/[\u0300-\u036f]/g, '')     // Entferne Diakritika
              .replace(/[^a-zA-Z0-9]/g, '_')       // Ersetze nicht-ASCII-Zeichen durch _
              .toLowerCase();

        const zone = normalizeRoomName(data.roomName);
        const title = data.state.currentTrack.title || '';
        const artist = data.state.currentTrack.artist || '';

        // Prüfe, ob sich etwas geändert hat
        const last = lastTrackPerZone[zone] || {};
        if (last.title === title && last.artist === artist) return;

        lastTrackPerZone[zone] = { title, artist };

        try {
            await sendTextInput(`${baseURL}/dev/sps/io/sonox_${zone}_playback_track_title`, title, auth);
            await sendTextInput(`${baseURL}/dev/sps/io/sonox_${zone}_playback_track_artist`, artist, auth);
            await sendTextInput(`${baseURL}/dev/sps/io/sonox_${zone}_playback_radio`, data.state.currentTrack.stationName || '', auth);
        } catch (err) {
            logger.error(`TextInputSync failed for ${zone}:`, {
                message: err.message,
                urlBase: baseURL,
                title,
                artist,
                radio: data.state.currentTrack.stationName || '',
            });
        }
    });
}

async function sendTextInput(url, value, auth) {
    await axios.get(url, {
        params: { value },
        timeout: 3000,
        headers: {
            'Authorization': `Basic ${auth}`
        }
    });
}

module.exports = setupTextInputSync;