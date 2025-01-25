'use strict';
const logger = require('sonos-discovery/lib/helpers/logger');
const isRadioOrLineIn = require('../helpers/is-radio-or-line-in');

function saveAll(system) {
  const backupPresets = system.zones.map((zone) => {
    const coordinator = zone.coordinator;
    const state = coordinator.state;
    const preset = {
      players: [
        { roomName: coordinator.roomName, volume: state.volume }
      ],
      state: state.playbackState,
      uri: coordinator.avTransportUri,
      metadata: coordinator.avTransportUriMetadata,
      playMode: {
        repeat: state.playMode.repeat
      }
    };

    if (!isRadioOrLineIn(preset.uri)) {
      preset.trackNo = state.trackNo;
      preset.elapsedTime = state.elapsedTime;
    }

    zone.members.forEach(function (player) {
      if (coordinator.uuid != player.uuid)
        preset.players.push({ roomName: player.roomName, volume: player.state.volume });
    });

    return preset;

  });

  logger.trace('backup presets', backupPresets);
  return backupPresets.sort((a,b) => {
    return a.players.length < b.players.length;
  });
}

function saveAvailable(system) {
  const backupPresets = system.players
      .filter(player => player.state.playbackState !== 'PLAYING')
      .map((player) => {
        return {
          players: [
            { roomName: player.roomName, volume: player.state.volume }
          ],
          state: player.state.playbackState,
          uri: player.avTransportUri,
          metadata: player.avTransportUriMetadata,
          playMode: {
            repeat: player.state.playMode.repeat
          },
          trackNo: player.state.trackNo,
          elapsedTime: player.state.elapsedTime
        };
      });

  logger.trace('backup available presets', backupPresets);
  return backupPresets;
}


function announceAll(system, uri, volume, duration) {
  let abortTimer;

  // Save all players
  var backupPresets = saveAll(system);

  // find biggest group and all players
  const allPlayers = [];
  let biggestZone = {};
  system.zones.forEach(function (zone) {
    if (!biggestZone.members || zone.members.length > biggestZone.members.length) {
      biggestZone = zone;
    }
  });

  const coordinator = biggestZone.coordinator;

  allPlayers.push({ roomName: coordinator.roomName, volume });

  system.players.forEach(player => {
    if (player.uuid == coordinator.uuid) return;
    allPlayers.push({ roomName: player.roomName, volume });
  });

  const preset = {
    uri,
    players: allPlayers,
    playMode: {
      repeat: false
    },
    pauseOthers: true,
    state: 'STOPPED'
  };

  const oneGroupPromise = new Promise((resolve) => {
    const onTopologyChanged = (topology) => {
      if (topology.length === 1) {
        return resolve();
      }
      // Not one group yet, continue listening
      system.once('topology-change', onTopologyChanged);
    };

    system.once('topology-change', onTopologyChanged);
  });

  const restoreTimeout = duration + 2000;
  return system.applyPreset(preset)
      .then(() => {
        if (system.zones.length === 1) return;
        return oneGroupPromise;
      })
      .then(() => {
        coordinator.play();
        return new Promise((resolve) => {
          const transportChange = (state) => {
            logger.debug(`Player changed to state ${state.playbackState}`);
            if (state.playbackState === 'STOPPED') {
              return resolve();
            }

            coordinator.once('transport-state', transportChange);
          };
          setTimeout(() => {
            coordinator.once('transport-state', transportChange);
          }, duration / 2);

          logger.debug(`Setting restore timer for ${restoreTimeout} ms`);
          abortTimer = setTimeout(resolve, restoreTimeout);
        });
      })
      .then(() => {
        clearTimeout(abortTimer);
      })
      .then(() => {
        return backupPresets.reduce((promise, preset) => {
          logger.trace('Restoring preset', preset);
          return promise.then(() => system.applyPreset(preset));
        }, Promise.resolve());
      })
      .catch((err) => {
        logger.error(err.stack);
        throw err;
      });

}

function announceAvailable(system, uri, volume, duration) {
  let abortTimer;

  // Save all players
  var backupPresets = saveAvailable(system);

  // Filter players that are not currently playing
  const availablePlayers = system.players.filter(player => player.state.playbackState !== 'PLAYING');

  if (availablePlayers.length === 0) {
    return Promise.reject(new Error('No available players to play the clip.'));
  }

  // Prepare preset for available players
  const preset = {
    uri,
    players: availablePlayers.map(player => ({ roomName: player.roomName, volume })),
    playMode: {
      repeat: false
    },
    pauseOthers: false, // Do not pause others globally
    state: 'PLAYING' // Start in PLAYING state
  };

  logger.debug(`Applying preset to available players: ${JSON.stringify(preset, null, 2)}`);

  const restoreTimeout = duration + 2000;
  return system.applyPreset(preset)
      .then(() => {
        logger.debug('Preset applied, waiting for playback to start.');

        // Force playback start
        const coordinator = system.getPlayer(availablePlayers[0].roomName);
        return coordinator.play();
      })
      .then(() => {
        logger.debug('Playback started, waiting for clip to finish.');
        return new Promise((resolve) => {
          setTimeout(resolve, duration + 2000); // Wait for the clip to finish
        });
      })
      .then(() => {
        clearTimeout(abortTimer);
        logger.debug('Restoring original presets.');
        return backupPresets.reduce((promise, preset) => {
          logger.trace('Restoring preset', preset);
          return promise.then(() => system.applyPreset(preset));
        }, Promise.resolve());
      })
      .catch((err) => {
        logger.error(`Error during announceAvailable: ${err.message}`);
        throw err;
      });
}

module.exports.announceAll = announceAll;
module.exports.available = announceAvailable;
module.exports.saveAll = saveAll;
