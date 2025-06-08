const axios = require('axios');
const logger = require('sonos-discovery/lib/helpers/logger');


let lastTrackPerZone = {};
let players = [];

async function setupTextInputSync(discovery, settings) {
    const config = settings.textInputSync;
    const license = settings.license;

    const protocol = config.use_ssl ? 'https' : 'http';
    const auth = Buffer.from(`${config.user}:${decodeURIComponent(config.pass)}`).toString('base64');
    const baseURL = `${protocol}://${config.host}:${config.port}`;

    function getMembersForCoordinator(uuid) {
        const zones = players[0]?.system?.zones || [];
        const zone = zones.find(z => z.coordinator.uuid === uuid);
        return zone ? zone.members : [];
    }

    if (!license?.key || !config?.enabled) {
        logger.info('TextInputSync is disabled or no license key present.');
        return;
    }


    discovery.on('transport-state', async (data) => {
        if (!players.length) {
            players = discovery.players;
        }
        const normalizeRoomName = (name) =>
            name
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9]/g, '')
                .toLowerCase();

        const title = data.state.currentTrack.title || '';
        const artist = data.state.currentTrack.artist || '';
        const radio = data.state.currentTrack.stationName || '';
        const playbackState = data.state.playbackState || '';

        // hole alle Mitglieder der Zone
        const members = getMembersForCoordinator(data.uuid);
        logger.info(`TextInputSync: Handling transport-state event from "${data.roomName}" (${data.uuid})`);
        if (members.length === 0) {
            logger.debug(`TextInputSync: No grouped players for "${data.roomName}" (${data.uuid}) – treating as standalone`);
        }
        for (const member of members) {
            logger.info(`TextInputSync: Evaluating updates for room "${member.roomName}"`);
            const room = normalizeRoomName(member.roomName);

            // Prüfe pro Raum, ob sich etwas geändert hat
            const last = lastTrackPerZone[room];
            if (
                last &&
                last.title === title &&
                last.artist === artist &&
                last.radio === radio &&
                last.state === playbackState
            ) {
                continue;
            }

            lastTrackPerZone[room] = {title, artist, radio, state: playbackState};

            const updates = [
                { key: 'title', value: title },
                { key: 'artist', value: artist },
                { key: 'radio', value: radio },
                { key: 'state', value: playbackState }
            ];

            for (const { key, value } of updates) {
                const url = `${baseURL}/dev/sps/io/sonox_${room}_current_${key}`;
                await sendTextInput(url, value, auth);
            }
        }
    });
}

async function sendTextInput(url, value, auth) {
    const fullUrl = `${url}/${encodeURIComponent(value)}`;
    try {
        const response = await axios.get(fullUrl, {
            timeout: 3000,
            headers: { 'Authorization': `Basic ${auth}` }
        });

        // Nur bei erfolgreicher Statusantwort loggen
        if (response.status < 300) {
            logger.info(`TextInputSync success: Sent value "${value}" to ${fullUrl}`);
        }
    } catch (error) {
        logger.error(`TextInputSync error: Failed to send to ${fullUrl}`, { value, error: error.message });
    }
}

module.exports = setupTextInputSync;