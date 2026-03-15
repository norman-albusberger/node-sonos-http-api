'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
const fileDuration = require('../helpers/file-duration');
const settings = require('../../settings');
const logger = require('sonos-discovery/lib/helpers/logger');

const DEFAULT_SETTINGS = {
  OutputFormat: 'mp3',
  VoiceId: 'Joanna',
  TextType: 'text'
};

async function collectAudioStream(audioStream) {
  if (!audioStream) {
    throw new Error('AWS Polly returned no audio stream');
  }

  if (typeof audioStream.transformToByteArray === 'function') {
    const bytes = await audioStream.transformToByteArray();
    return Buffer.from(bytes);
  }

  const chunks = [];
  for await (const chunk of audioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function polly(phrase, voiceName) {
  if (!settings.aws) {
    return Promise.resolve();

  }

  // Construct a filesystem neutral filename
  const dynamicParameters = { Text: phrase };
  const synthesizeParameters = Object.assign({}, DEFAULT_SETTINGS, dynamicParameters);
  if (settings.aws.name) {
    synthesizeParameters.VoiceId = settings.aws.name;
  }
  if (voiceName) {
    synthesizeParameters.VoiceId = voiceName;
  }
  if (synthesizeParameters.VoiceId.endsWith('Neural')) {
    synthesizeParameters.Engine = 'neural';
    synthesizeParameters.VoiceId = synthesizeParameters.VoiceId.slice(0, -6);
  }

  const phraseHash = crypto.createHash('sha1').update(phrase).digest('hex');
  const filename = `polly-${phraseHash}-${synthesizeParameters.VoiceId}.mp3`;
  const filepath = path.resolve(settings.webroot, 'tts', filename);

  const expectedUri = `/tts/${filename}`;
  try {
    fs.accessSync(filepath, fs.constants.R_OK);
    return fileDuration(filepath)
      .then((duration) => {
        return {
          duration,
          uri: expectedUri
        };
      });
  } catch (err) {
    logger.info(`announce file for phrase "${phrase}" does not seem to exist, downloading`);
  }

  const client = new PollyClient(settings.aws.credentials || {});

  return client.send(new SynthesizeSpeechCommand(synthesizeParameters))
    .then((data) => {
      return collectAudioStream(data.AudioStream);
    })
    .then((audioBuffer) => {
      fs.writeFileSync(filepath, audioBuffer);
      return fileDuration(filepath);
    })
    .then((duration) => {
      return {
        duration,
        uri: expectedUri
      };
    });
}

module.exports = polly;
