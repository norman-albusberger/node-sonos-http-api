'use strict';

const request = require('../helpers/fetch-request');

const appleDef = require('../music_services/appleDef');
const spotifyDef = require('../music_services/spotifyDef');
const deezerDef = require('../music_services/deezerDef');
const eliteDef = deezerDef.init(true);
const libraryDef = require('../music_services/libraryDef');

const musicServices = ['apple', 'spotify', 'deezer', 'elite', 'library'];
const serviceNames = {
  apple: 'Apple Music',
  spotify: 'Spotify',
  deezer: 'Deezer',
  elite: 'Deezer',
  library: 'Library'
};
const musicTypes = ['album', 'song', 'station', 'load', 'playlist'];

function getService(service) {
  if (service === 'apple') {
    return appleDef;
  }
  if (service === 'spotify') {
    return spotifyDef;
  }
  if (service === 'deezer') {
    return deezerDef;
  }
  if (service === 'elite') {
    return eliteDef;
  }
  if (service === 'library') {
    return libraryDef;
  }

  return null;
}

function createSearchContext() {
  return {
    country: '',
    accountId: '',
    accountSN: '',
    searchType: 0
  };
}

function shuffleArray(items) {
  const copy = items.slice();

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const temp = copy[index];
    copy[index] = copy[randomIndex];
    copy[randomIndex] = temp;
  }

  return copy;
}

function getAccountData(player, service, context) {
  if (service === 'library') {
    return Promise.resolve(context);
  }

  return request({ url: `${player.baseUrl}/status/accounts`, json: false })
    .then((response) => {
      const serviceType = player.system.getServiceType(serviceNames[service]);
      const activeLocation = response.indexOf(serviceType);

      if (activeLocation !== -1) {
        const idLocation = response.indexOf('<UN>', activeLocation) + 4;
        const serialLocation = response.indexOf('SerialNum="', activeLocation) + 11;

        context.accountId = response.substring(idLocation, response.indexOf('</UN>', idLocation));
        context.accountSN = response.substring(serialLocation, response.indexOf('"', serialLocation));
      }

      return context;
    });
}

function getRequestOptions(serviceDef, url) {
  return {
    url,
    json: true,
    headers: serviceDef.headers()
  };
}

function parseSearchTerm(serviceDef, service, type, term, context) {
  let decodedTerm = decodeURIComponent(term);
  let artistPosition = -1;
  let albumPosition = -1;
  let trackPosition = -1;
  let nextPosition = -1;
  let artist = '';
  let album = '';
  let track = '';
  let newTerm;

  if (decodedTerm.indexOf(':') > -1) {
    artistPosition = decodedTerm.indexOf('artist:');
    albumPosition = decodedTerm.indexOf('album:');
    trackPosition = decodedTerm.indexOf('track:');

    if (artistPosition > -1) {
      nextPosition = (albumPosition < trackPosition) ? albumPosition : trackPosition;
      artist = decodedTerm.substring(artistPosition + 7, (artistPosition < nextPosition) ? nextPosition : decodedTerm.length);
    }
    if (albumPosition > -1) {
      nextPosition = (trackPosition < artistPosition) ? trackPosition : artistPosition;
      album = decodedTerm.substring(albumPosition + 6, (albumPosition < nextPosition) ? nextPosition : decodedTerm.length);
    }
    if (trackPosition > -1) {
      nextPosition = (albumPosition < artistPosition) ? albumPosition : artistPosition;
      track = decodedTerm.substring(trackPosition + 6, (trackPosition < nextPosition) ? nextPosition : decodedTerm.length);
    }

    newTerm = serviceDef.term(type, decodedTerm, artist, album, track);
  } else {
    newTerm = service === 'library' ? decodedTerm : encodeURIComponent(decodedTerm);
  }

  if (type === 'song') {
    context.searchType = trackPosition > -1 ? 1 : (artistPosition > -1 ? 2 : 0);
  }

  return newTerm;
}

function doSearch(player, service, type, term, context) {
  const serviceDef = getService(service);
  let url = serviceDef.search[type];
  const newTerm = parseSearchTerm(serviceDef, service, type, term, context);

  url += newTerm;

  if (service === 'library') {
    return Promise.resolve(libraryDef.searchlib(type, newTerm));
  }

  if (serviceDef.country !== '' && context.country === '') {
    return request({ url: 'http://ipinfo.io', json: true })
      .then((response) => {
        context.country = response.country;
        url += serviceDef.country + context.country;
        return serviceDef.authenticate().then(() => request(getRequestOptions(serviceDef, url)));
      });
  }

  if (serviceDef.country !== '') {
    url += serviceDef.country + context.country;
  }

  return serviceDef.authenticate().then(() => request(getRequestOptions(serviceDef, url)));
}

function loadTracks(player, service, type, tracksJson, context, serviceContext) {
  const tracks = getService(service).tracks(type, tracksJson, serviceContext);

  if (service === 'library' && type === 'album') {
    tracks.isArtist = true;
  } else if (type !== 'album') {
    if (context.searchType === 0) {
      if (tracks.count > 1) {
        let artistCount = 1;
        let trackCount = 1;
        const artists = tracks.queueTracks.map((track) => track.artistName.toLowerCase()).sort();
        const songs = tracks.queueTracks.map((track) => track.trackName.toLowerCase()).sort();

        let previousArtist = artists[0];
        let previousTrack = songs[0];

        for (let index = 1; index < tracks.count; index += 1) {
          if (artists[index] !== previousArtist) {
            artistCount += 1;
            previousArtist = artists[index];
          }
          if (songs[index] !== previousTrack) {
            trackCount += 1;
            previousTrack = songs[index];
          }
        }

        tracks.isArtist = trackCount / artistCount > 2;
      }
    } else {
      tracks.isArtist = context.searchType === 2;
    }
  }

  if (tracks.isArtist && player.coordinator.state.playMode.shuffle) {
    tracks.queueTracks = shuffleArray(tracks.queueTracks);
  }

  return tracks;
}

function musicSearch(player, values) {
  const service = values[0];
  const type = values[1];
  const term = values[2];
  const queueURI = `x-rincon-queue:${player.coordinator.uuid}#0`;
  const context = createSearchContext();

  if (!musicServices.includes(service)) {
    return Promise.reject('Invalid music service');
  }

  if (!musicTypes.includes(type)) {
    return Promise.reject(`Invalid type ${type}`);
  }

  if (service === 'library' && (type === 'load' || libraryDef.nolib())) {
    return libraryDef.load(player, type === 'load');
  }

  return getAccountData(player, service, context)
    .then(() => doSearch(player, service, type, term, context))
    .then((resultList) => {
      const serviceDef = getService(service);
      const serviceContext = serviceDef.service(player, context.accountId, context.accountSN, context.country);

      if (serviceDef.empty(type, resultList)) {
        return Promise.reject('No matches were found');
      }

      if (type === 'station') {
        const uriAndMetadata = serviceDef.urimeta(type, resultList, serviceContext);
        return player.coordinator.setAVTransport(uriAndMetadata.uri, uriAndMetadata.metadata)
          .then(() => player.coordinator.play());
      }

      if ((type === 'album' || type === 'playlist') && service !== 'library') {
        const uriAndMetadata = serviceDef.urimeta(type, resultList, serviceContext);
        return player.coordinator.clearQueue()
          .then(() => player.coordinator.setAVTransport(queueURI, ''))
          .then(() => player.coordinator.addURIToQueue(uriAndMetadata.uri, uriAndMetadata.metadata, true, 1))
          .then(() => player.coordinator.play());
      }

      const tracks = loadTracks(player, service, type, resultList, context, serviceContext);

      if (tracks.count === 0) {
        return Promise.reject('No matches were found');
      }

      if (tracks.isArtist) {
        return player.coordinator.clearQueue()
          .then(() => player.coordinator.setAVTransport(queueURI, ''))
          .then(() => player.coordinator.addURIToQueue(tracks.queueTracks[0].uri, tracks.queueTracks[0].metadata, true, 1))
          .then(() => player.coordinator.play())
          .then(() => {
            tracks.queueTracks.slice(1).reduce((promise, track, index) => {
              return promise.then(() => player.coordinator.addURIToQueue(track.uri, track.metadata, true, index + 2));
            }, Promise.resolve());
          });
      }

      let queueIsEmpty = false;
      let nextTrackNumber = 0;

      return player.coordinator.getQueue(0, 1)
        .then((queue) => {
          queueIsEmpty = queue.length === 0;
          nextTrackNumber = queueIsEmpty ? 1 : player.coordinator.state.trackNo + 1;
        })
        .then(() => player.coordinator.addURIToQueue(tracks.queueTracks[0].uri, tracks.queueTracks[0].metadata, true, nextTrackNumber))
        .then(() => player.coordinator.setAVTransport(queueURI, ''))
        .then(() => {
          if (!queueIsEmpty) {
            return player.coordinator.nextTrack();
          }
          return undefined;
        })
        .then(() => player.coordinator.play());
    });
}

module.exports = function (api) {
  api.registerAction('musicsearch', musicSearch);
  libraryDef.read();
};
