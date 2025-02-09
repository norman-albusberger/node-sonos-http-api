const mqtt = require('mqtt');
const logger = require('sonos-discovery/lib/helpers/logger');

function publishMqttData(mqttClient, topic, payload) {
    if (mqttClient.connected) {
        mqttClient.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
            if (err) {
                console.error(`Error while sending to topic ${topic}:`, err.message);
            } else {
                console.log(`Message sent to topic ${topic}. { payload: ${JSON.stringify(payload)} }`);
            }
        });
    } else {
        console.error(`MQTT connection not available. Message queued for 5 seconds: ${topic}`);
        setTimeout(() => publishMqttData(mqttClient, topic, payload), 5000); // Wiederhole nach 5 Sekunden
    }
}

function setupMQTT(discovery, settings) {
    const mqttClient = mqtt.connect(settings.mqtt.broker.startsWith('mqtt://') ? settings.mqtt.broker : `mqtt://${settings.mqtt.broker}`, {
        username: settings.mqtt.username,
        password: settings.mqtt.password,
        keepalive: 60
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

    // Topology-Change-Event
    discovery.on('topology-change', (zones) => {
        zones.forEach((zone) => {
            console.log(zone)
            const topic = `sonox/${zone.coordinator.roomName}/zone`;
            publishMqttData(mqttClient, topic, zone);
        });
    });

    // Transport-State-Event
    discovery.on('transport-state', (data) => {
        const topic = `sonox/${data.roomName}/playback`;
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
        publishMqttData(mqttClient, topic, payload);
    });

    // Volume-Change-Event
    discovery.on('volume-change', (data) => {
        const topic = `sonox/${data.roomName}/volume`;
        const payload = {
            previousVolume: data.previousVolume,
            newVolume: data.newVolume
        };
        publishMqttData(mqttClient, topic, data);
    });
}

module.exports = setupMQTT;
