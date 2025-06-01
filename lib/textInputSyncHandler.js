const axios = require('axios');
const logger = require('sonos-discovery/lib/helpers/logger');

let lastTrackPerZone = {};

function setupTextInputSync(discovery, settings) {
    const config = settings.textInputSync;
    const license = settings.license;

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
              .replace(/[^a-zA-Z0-9]/g, '')       // Entferne nicht-ASCII-Zeichen
              .toLowerCase();



        const zone = normalizeRoomName(data.roomName);

        if (!['PLAYING', 'PAUSED_PLAYBACK', 'STOPPED'].includes(data.state.playbackState)) {
            return;
        }

        const title = data.state.currentTrack.title || '';
        const artist = data.state.currentTrack.artist || '';

        const playbackState = data.state.playbackState || '';
        const playbackLabel = {
            PLAYING: 'Playing',
            PAUSED_PLAYBACK: 'Paused',
            STOPPED: 'Stopped',
        }[playbackState] || playbackState;

        logger.info(`Detected transport-state for zone "${data.roomName}" normalized as "${zone}"`);

        // Prüfe, ob sich etwas geändert hat
        const last = lastTrackPerZone[zone] || {};
        if (last.title === title && last.artist === artist) return;

        lastTrackPerZone[zone] = { title, artist };

        try {
            await sendTextInput(`${baseURL}/dev/sps/io/sonox_${zone}_current_title`, title, auth);
        } catch (err) {
            logger.error(`TextInputSync failed sending TITLE for zone "${zone}"`, {
                url: `${baseURL}/dev/sps/io/sonox_${zone}_current_title`,
                value: title,
            });
        }

        try {
            await sendTextInput(`${baseURL}/dev/sps/io/sonox_${zone}_current_artist`, artist, auth);
        } catch (err) {
            logger.error(`TextInputSync failed sending ARTIST for zone "${zone}"`, {
                url: `${baseURL}/dev/sps/io/sonox_${zone}_current_artist`,
                value: artist,
            });
        }

        try {
            const radio = data.state.currentTrack.stationName || '';
            await sendTextInput(`${baseURL}/dev/sps/io/sonox_${zone}_current_radio`, radio, auth);
        } catch (err) {
            logger.error(`TextInputSync failed sending RADIO for zone "${zone}"`, {
                url: `${baseURL}/dev/sps/io/sonox_${zone}_current_radio`,
                value: data.state.currentTrack.stationName || '',
            });
        }

        try {
            await sendTextInput(`${baseURL}/dev/sps/io/sonox_${zone}_current_state`, playbackLabel, auth);
        } catch (err) {
            logger.error(`TextInputSync failed sending STATE for zone "${zone}"`, {
                url: `${baseURL}/dev/sps/io/sonox_${zone}_current_state`,
                value: playbackLabel,
            });
        }
    });
}

async function sendTextInput(url, value, auth) {
    const fullUrl = `${url}/${encodeURIComponent(value)}`;
    await axios.get(fullUrl, {
        timeout: 3000,
        headers: {
            'Authorization': `Basic ${auth}`
        }
    });
    logger.info(`TextInputSync success: Sent value "${value}" to ${fullUrl}`);
}

module.exports = setupTextInputSync;