'use strict';
const dgram = require('dgram');
const EventEmitter = require('events').EventEmitter;
const os = require('os');
const logger = require('./helpers/logger');

function findLocalEndpoints() {
  const interfaces = os.networkInterfaces();
  const endpoints = new Set(['0.0.0.0']);

  for (const name in interfaces) {
    interfaces[name]
      .filter((ipInfo) => ipInfo.internal === false && ipInfo.family === 'IPv4')
      .forEach((ipInfo) => endpoints.add(ipInfo.address));
  }

  return Array.from(endpoints);
}

function SSDP() {
  const SONOS_PLAYER_UPNP_URN = 'urn:schemas-upnp-org:device:ZonePlayer:1';
  const PLAYER_SEARCH = Buffer.from(['M-SEARCH * HTTP/1.1',
    'HOST: 239.255.255.250:reservedSSDPport',
    'MAN: ssdp:discover',
    'MX: 1',
    'ST: ' + SONOS_PLAYER_UPNP_URN].join('\r\n'));

  let socket;
  let _this = this;
  let scanTimeout;
  let socketCycleInterval;

  const localEndpoints = findLocalEndpoints();
  const remoteEndpoints = ['239.255.255.250', '255.255.255.255'];
  let remoteEndpointIndex = 0;
  let localEndpointIndex = 0;

  function receiveHandler(buffer, rinfo) {
    const response = buffer.toString('ascii');

    if (response.indexOf(SONOS_PLAYER_UPNP_URN) === -1) {
      // Ignore false positive from badly-behaved non-Sonos device.
      return;
    }

    const headerCollection = response.split('\r\n');
    let household;
    let location;

    for (let i = 0; i < headerCollection.length; i += 1) {
      const headerRow = headerCollection[i];
      const separatorIndex = headerRow.indexOf(':');

      if (separatorIndex === -1) {
        continue;
      }

      const headerName = headerRow.slice(0, separatorIndex).trim().toUpperCase();
      const headerValue = headerRow.slice(separatorIndex + 1).trim();

      if (headerName === 'LOCATION') {
        location = headerValue;
      } else if (headerName === 'X-RINCON-HOUSEHOLD') {
        household = headerValue;
      }

      if (location && household) {
        break;
      }
    }

    if (!location) return;

    _this.emit('found', {
      household,
      location,
      ip: rinfo.address
    });
  }

  function sendScan() {
    logger.trace('sending M-SEARCH...');

    // Alternate between 239.255.255.250 and 255.255.255.255 to increase discoverability in complex environment
    const remoteEndpoint = remoteEndpoints[remoteEndpointIndex++ % remoteEndpoints.length];
    socket.send(PLAYER_SEARCH, 0, PLAYER_SEARCH.length, 1900, remoteEndpoint);
    scanTimeout = setTimeout(sendScan, 1000);
  }

  function start() {
    createSocket(() => {
      sendScan();
    });

    socketCycleInterval = setInterval(() => {
      createSocket();
    }, 5000);
  }

  function createSocket(callback) {
    if (socket) {
      socket.close();
    }

    socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }, receiveHandler);
    const endpoint = localEndpoints[localEndpointIndex++ % localEndpoints.length];
    socket.bind(1905, endpoint, () => {
      // This allows discovery through one router hop in a vlan environment
      socket.setMulticastTTL(2);

      // We set this in order to send 255.255.255.255 discovery requests. Doesn't matter for SSDP endpoint
      socket.setBroadcast(true);
      if (callback instanceof Function) {
        callback();
      }
    });
  }

  function stop() {
    if (!socket) return;
    socket.close();
    socket = null;
    clearInterval(socketCycleInterval);
    clearTimeout(scanTimeout);
  }

  this.start = start;
  this.stop = stop;
}

Object.setPrototypeOf(SSDP.prototype, EventEmitter.prototype);
Object.setPrototypeOf(SSDP, EventEmitter);

module.exports = new SSDP();
