'use strict';
const path = require('path');
const fileDuration = require('../helpers/file-duration');
const settings = require('../../settings');
require('../helpers/single-player-announcement');
let port;
// Importiere attachTo und isolate aus der group-Logik
const {attachTo, isolate} = require('./group');

const LOCAL_PATH_LOCATION = path.join(settings.webroot, 'clips');


async function playClipAvailable(player, values) {
    const clipFileName = values[0];
    let announceVolume = settings.announceVolume || 40;

    if (/^\d+$/i.test(values[1])) {
        announceVolume = values[1];
    }

    const discovery = player.system;

    // Speichere den ursprünglichen Zustand aller nicht-spielenden Zonen
    const originalGroups = {};
    const availablePlayers = [];

    discovery.zones.forEach(zone => {
        const master = zone.coordinator.roomName;

        // Prüfe, ob die Zone spielt
        const isZonePlaying = zone.members.some(member => member.state.playbackState === 'PLAYING');
        if (isZonePlaying) {
            console.log(`Zone ${master} wird übersprungen, da sie spielt.`);
            return; // Überspringe diese Zone
        }

        // Speichere die Gruppenstruktur für nicht-spielende Zonen
        originalGroups[master] = zone.members.map(member => member.roomName);

        // Füge die Geräte der Zone zu den verfügbaren Playern hinzu
        zone.members.forEach(member => {
            availablePlayers.push(member.roomName);
        });
    });

    if (availablePlayers.length === 0) {
        throw new Error('Keine verfügbaren Geräte gefunden.');
    }

    // Wähle ein Gerät als Master
    const masterPlayer = discovery.getPlayer(availablePlayers[0]);
    const devicesToGroup = availablePlayers.slice(1);

    // Mache den Master zu einer eigenständigen Gruppe
    await masterPlayer.becomeCoordinatorOfStandaloneGroup();

    await masterPlayer.setAVTransport(`http://${player.system.localEndpoint}:${port}/clips/${clipFileName}`);

    // Gruppiere die anderen Geräte mit dem Master
    for (const device of devicesToGroup) {
        const groupPlayer = discovery.getPlayer(device);
        await groupPlayer.setVolume(announceVolume)
        if (!groupPlayer) {
            console.error(`Gerät "${device}" nicht gefunden.`);
            continue;
        }

        await attachTo(groupPlayer, masterPlayer);
    }

    // Bestimme die Dauer des Clips
    const duration = await fileDuration(path.join(LOCAL_PATH_LOCATION, clipFileName));

    // starte die Wiedergabe
    try {
        await masterPlayer.play();
    } catch (e) {
        console.error(e);
    }


    // Warte, bis die Wiedergabe beendet ist
    await new Promise(resolve => setTimeout(resolve, duration + 1000));

    await Promise.all(
        Object.keys(originalGroups).map(async master => {
            const masterPlayer = discovery.getPlayer(master);
            if (!masterPlayer || !masterPlayer.uuid) {
                console.error(`Could not find master ${master}.`);
                return;
            }

            try {
                console.log(`Isolating: ${master}`);
                await isolate(masterPlayer);
            } catch (error) {
                console.error(error.message);
            }

            for (const device of originalGroups[master]) {
                const groupPlayer = discovery.getPlayer(device);
                if (!groupPlayer || !groupPlayer.uuid) {
                    console.error(`Device ${device} could not be found.`);
                    continue;
                }

                try {
                    console.log(`Adding ${device} to group ${master} `);
                    if (groupPlayer.uuid !== masterPlayer.uuid)
                        await attachTo(groupPlayer, masterPlayer);
                } catch (error) {
                    console.error(`Error while adding ${device} to group ${master}:`, error.message);
                }
            }
        })
    );

    return {success: true, message: 'played mp3 file and groups restored.'};
}


module.exports = function (api) {
    port = api.getPort();
    api.registerAction('clipavailable', playClipAvailable);
};
