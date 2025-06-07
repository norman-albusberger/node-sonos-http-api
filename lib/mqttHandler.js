const mqtt = require('mqtt');
const logger = require('sonos-discovery/lib/helpers/logger');

let mqttClient = null;
let lastPayloads = new Map();
let lastFlushTime = Date.now();

let publishQueue = [];
let publishTimeout = null;

function queueMqttMessage(mqttClient, topic, payload) {
    publishQueue.push({ mqttClient, topic, payload });
    if (!publishTimeout) {
        publishTimeout = setTimeout(flushQueue, 200);
    }
}

function publishMqttData(mqttClient, topic, payload, retries = 0) {
    if (mqttClient.connected) {
        mqttClient.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
            if (err) {
                logger.error(`Error while sending to topic ${topic}:`, err.message);
            } else {
                logger.info(`MQTT → ${topic}`, JSON.stringify(payload, null, 2));
            }
        });
    } else {
        if (retries < 3) {
            logger.error(`MQTT connection not available. Retry ${retries + 1}/3: ${topic}`);
            setTimeout(() => publishMqttData(mqttClient, topic, payload, retries + 1), 5000);
        } else {
            logger.error(`MQTT message dropped after 3 retries: ${topic}`);
        }
    }
}

function flushQueue() {
    const now = Date.now();
    const delay = now - lastFlushTime < 100 ? 100 - (now - lastFlushTime) : 0;
    lastFlushTime = now + delay;

    setTimeout(() => {
        publishQueue.forEach(({ mqttClient, topic, payload }) => {
            const json = JSON.stringify(payload);
            if (lastPayloads.get(topic) === json) {
                return; // Skip identical payload
            }
            lastPayloads.set(topic, json);
            publishMqttData(mqttClient, topic, payload);
        });
        publishQueue = [];
        publishTimeout = null;
    }, delay);
}

function setupMQTT(discovery, settings) {
    mqttClient = mqtt.connect(settings.mqtt.broker.startsWith('mqtt://') ? settings.mqtt.broker : `mqtt://${settings.mqtt.broker}`, {
        username: settings.mqtt.username,
        password: settings.mqtt.password,
        keepalive: 30,
        reconnectPeriod: 3000,
        clientId: `sonox-${Math.random().toString(16).substr(2, 8)}`,
        clean: true,
        connectTimeout: 10000,
        will: {
            topic: 'sonox/status',
            payload: 'offline',
            qos: 1,
            retain: true
        }
    });


    mqttClient.on('connect', () => {
        logger.info('MQTT connected:', settings.mqtt.broker);
    });

    mqttClient.on('error', (err) => {
        logger.error('MQTT Connection Error:', err.message);
    });

    mqttClient.on('close', () => {
        logger.error('MQTT connection closed.');
    });

    mqttClient.on('offline', () => {
        logger.warn('MQTT client is offline.');
    });

    mqttClient.on('reconnect', () => {
        logger.info('MQTT client attempting to reconnect...');
    });

    mqttClient.stream.on('error', (err) => {
        logger.error('Low-level stream error:', err.message);
    });

    // Topology-Change-Event
    discovery.on('topology-change', (zones) => {
        zones.forEach((zone) => {
            const safeRoom = (zone.coordinator?.roomName || 'unknown').replace(/[#+/]/g, '_');
            const topic = `sonox/${safeRoom}/zone`;
            queueMqttMessage(mqttClient, topic, zone);
        });
    });

    // Transport-State-Event
    discovery.on('transport-state', (data) => {
        if (!data.roomName) return;
        const safeRoom = (data.roomName || 'unknown').replace(/[#+/]/g, '_');
        const topic = `sonox/${safeRoom}/playback`;
        const payload = {
            state: data.state.playbackState,
            track: {
                title: data.state.currentTrack.title,
                artist: data.state.currentTrack.artist,
                album: data.state.currentTrack.album,
                duration: data.state.currentTrack.duration
            },
            volume: data.state.volume,
            mute: data.state.mute
        };
        queueMqttMessage(mqttClient, topic, payload);
    });

    // Volume-Change-Event
    discovery.on('volume-change', (data) => {
        if (!data.roomName) return;
        const safeRoom = (data.roomName || 'unknown').replace(/[#+/]/g, '_');
        const topic = `sonox/${safeRoom}/volume`;
        const payload = {
            previousVolume: data.previousVolume,
            newVolume: data.newVolume,
            volume: data.newVolume

        };
        queueMqttMessage(mqttClient, topic, payload);
    });
}

module.exports = setupMQTT;
module.exports.cleanup = () => {
    if (mqttClient && mqttClient.end) {
        if (publishQueue.length > 0) flushQueue();
        mqttClient.end(true);
    }
};
