const logger = require('sonos-discovery/lib/helpers/logger');


let lastTrackPerZone = {};
let players = [];

async function setupTextInputSync(discovery, settings) {
    const config = settings.textInputSync;

    // Entitlement for this feature - a feature switch, not an authorization
    // boundary: the key below is only tested for presence and never validated,
    // so anyone who can edit settings.json could always have set one.
    //
    // Two products consume this handler. SonoX-Pro sells licence keys and puts
    // one in settings.license. The SonoX appliance is a licensed product in its
    // own right - it is bound to its hardware instead of to a key and has no
    // settings.license at all, so it declares entitlement directly. Without
    // this second path the appliance configured the feature in its UI, tested
    // it successfully (its test talks to the Miniserver directly) and then
    // never sent a single value, because this function returned here on every
    // start.
    const entitled = Boolean(settings.license?.key) || config?.licensed === true;

    if (!entitled || !config?.enabled) {
        logger.info('TextInputSync not started: disabled, or no licence key and textInputSync.licensed not set.');
        return;
    }

    const protocol = config.use_ssl ? 'https' : 'http';
    const auth = Buffer.from(`${config.user}:${decodeURIComponent(config.pass)}`).toString('base64');
    const baseURL = `${protocol}://${config.host}:${config.port}`;

    function getMembersForCoordinator(uuid) {
        const zones = players[0]?.system?.zones || [];
        const zone = zones.find(z => z.coordinator.uuid === uuid);
        return zone ? zone.members : [];
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
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(fullUrl, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'Authorization': `Basic ${auth}` }
        });
        clearTimeout(timeoutId);

        // Nur bei erfolgreicher Statusantwort loggen
        if (response.ok) {
            logger.info(`TextInputSync success: Sent value "${value}" to ${fullUrl}`);
        }
    } catch (error) {
        logger.error(`TextInputSync error: Failed to send to ${fullUrl}`, { value, error: error.message });
    }
}

module.exports = setupTextInputSync;
