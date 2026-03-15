'use strict';

const settings = require('../../settings');

const PROVIDERS = [
  {
    id: 'aws-polly',
    configKey: 'aws',
    label: 'AWS Polly',
    parameterMode: 'voice',
    parameterDescription: 'Voice name, for example Joanna or AmyNeural',
    endpointExamples: [
      '/Office/say/Hello%20world/Joanna',
      '/Office/say/Hello%20world/AmyNeural/35'
    ]
  },
  {
    id: 'elevenlabs',
    configKey: 'elevenlabs',
    label: 'ElevenLabs',
    parameterMode: 'voiceId',
    parameterDescription: 'Voice ID when no default voiceId is configured',
    endpointExamples: [
      '/Office/say/Hello%20world/EXAVITQu4vr4xnSDxMaL',
      '/Office/say/Hello%20world/EXAVITQu4vr4xnSDxMaL/35'
    ]
  },
  {
    id: 'mac-os',
    configKey: 'macSay',
    label: 'macOS say',
    parameterMode: 'voice',
    parameterDescription: 'macOS voice name, for example Alex or Anna',
    endpointExamples: [
      '/Office/say/Hello%20world/Alex',
      '/Office/say/Hello%20world/Alex/35'
    ]
  },
  {
    id: 'microsoft',
    configKey: 'microsoft',
    label: 'Microsoft Speech',
    parameterMode: 'voice',
    parameterDescription: 'Voice name, for example ZiraRUS or Stefan',
    endpointExamples: [
      '/Office/say/Hello%20world/ZiraRUS',
      '/Office/say/Guten%20Morgen/Stefan/35'
    ]
  },
  {
    id: 'voicerss',
    configKey: 'voicerss',
    label: 'VoiceRSS',
    parameterMode: 'language',
    parameterDescription: 'Language code, for example en-gb or de-de',
    endpointExamples: [
      '/Office/say/Hello%20world/en-gb',
      '/Office/say/Hallo%20Welt/de-de/35'
    ]
  },
  {
    id: 'google',
    configKey: null,
    label: 'Google Translate TTS fallback',
    parameterMode: 'language',
    parameterDescription: 'Language code, for example en, en-gb or de',
    endpointExamples: [
      '/Office/say/Hello%20world/en',
      '/Office/say/Hallo%20Welt/de/35'
    ]
  }
];

function isConfigured(provider) {
  switch (provider.id) {
    case 'aws-polly':
      return Boolean(settings.aws);
    case 'elevenlabs':
      return Boolean(settings.elevenlabs);
    case 'mac-os':
      return Boolean(settings.macSay);
    case 'microsoft':
      return Boolean(settings.microsoft && settings.microsoft.key);
    case 'voicerss':
      return Boolean(settings.voicerss);
    case 'google':
      return true;
    default:
      return false;
  }
}

function getDefaultValue(provider) {
  switch (provider.id) {
    case 'aws-polly':
      return settings.aws && settings.aws.name ? settings.aws.name : 'Joanna';
    case 'elevenlabs':
      return settings.elevenlabs && settings.elevenlabs.config ? settings.elevenlabs.config.voiceId : undefined;
    case 'mac-os':
      return settings.macSay ? settings.macSay.voice : undefined;
    case 'microsoft':
      return settings.microsoft && settings.microsoft.name ? settings.microsoft.name : 'ZiraRUS';
    default:
      return undefined;
  }
}

function getConfiguredProviders() {
  return PROVIDERS.map((provider) => {
    const configured = isConfigured(provider);
    const defaultValue = getDefaultValue(provider);

    return {
      id: provider.id,
      label: provider.label,
      configured,
      parameterMode: provider.parameterMode,
      parameterDescription: provider.parameterDescription,
      defaultValue,
      endpointExamples: provider.endpointExamples
    };
  });
}

function getTtsDebugInfo() {
  const providers = getConfiguredProviders();
  const activeProviders = providers.filter((provider) => provider.configured);
  const preferredProvider = activeProviders[0] || null;

  return {
    endpoints: {
      say: '/{room}/say/{text}[/{voiceOrLanguageOrVolume}][/{volume}]',
      sayall: '/sayall/{text}[/{voiceOrLanguageOrVolume}][/{volume}]',
      saypreset: '/saypreset/{preset}/{text}[/{voiceOrLanguage}]'
    },
    parameterRules: {
      secondSegment: 'If the second optional segment is numeric, it is treated as volume. Otherwise it is forwarded to the active provider as either a language code, voice name or voiceId.',
      thirdSegment: 'For say and sayall, the third segment is always treated as volume when present.'
    },
    announceVolume: settings.announceVolume || 40,
    providerResolutionOrder: providers.map((provider) => provider.id),
    activeProviders: activeProviders.map((provider) => ({
      id: provider.id,
      label: provider.label,
      parameterMode: provider.parameterMode,
      parameterDescription: provider.parameterDescription,
      defaultValue: provider.defaultValue
    })),
    preferredProvider: preferredProvider ? {
      id: preferredProvider.id,
      label: preferredProvider.label,
      parameterMode: preferredProvider.parameterMode,
      parameterDescription: preferredProvider.parameterDescription,
      defaultValue: preferredProvider.defaultValue
    } : null,
    warnings: providers.filter((provider) => provider.configured && provider.id !== 'google').length > 1
      ? ['Multiple TTS providers are configured. They are tried in providerResolutionOrder until one succeeds.']
      : [],
    providers
  };
}

module.exports = getTtsDebugInfo;
