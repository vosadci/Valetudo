const express = require("express");
const https = require("https");
const Logger = require("../../Logger");
const tls = require("tls");
const {createBroker} = require("aedes");

/**
 * Local stand-in for aiot_client.bin's real cloud (eu-cdndevaiot.3irobotix.net /
 * eu-gamqttaiot.3irobotix.net). aiot_client itself is left completely unmodified on
 * the robot; this just answers its login + MQTT handshake the same way the real
 * cloud would, so it connects here instead.
 */
class KaercherAiotDummycloud {
    /**
     * @param {object} options
     * @param {import("./KaercherStaticTLSContext")} options.tlsContext
     * @param {string} options.bindIP
     * @param {(topic: string, envelope: object) => void} [options.onIncomingCloudMessage]
     * @param {() => void} [options.onConnected]
     */
    constructor(options) {
        this.tlsContext = options.tlsContext;
        this.bindIP = options.bindIP;
        this.onIncomingCloudMessage = options.onIncomingCloudMessage;
        this.onConnected = options.onConnected;

        this.setupHTTP();
        this.setupMQTT();
    }

    setupHTTP() {
        this.httpServer = https.createServer(this.tlsContext.getTLSOptions());

        const app = express();
        // aiot_client's login POST isn't guaranteed to set Content-Type: application/json
        // (unconfirmed either way); match login_server.py's unconditional json.loads()
        // rather than silently 200-ing with an empty body if it doesn't.
        app.use(express.json({type: () => true}));

        app.post("/device-service/auth/login", (req, res) => {
            const {sn = "", mac = "", tenantId = "", productModeCode = ""} = req.body ?? {};

            this.sn = sn;
            this.mac = mac;

            Logger.info(`KaercherAiotDummycloud: handling device login for sn=${sn}`);

            res.status(200).json({
                code: 0,
                result: {
                    id: "0",
                    clientType: "ROBOT",
                    data: {
                        AUTH: "local-auth-token",
                        CONNECTION_TYPE: "device",
                        COUNTRY_CITY: "",
                        EMQ_TOKEN: "local-emq-token",
                        MAC: mac,
                        PRODUCT_MODE_CODE: productModeCode,
                        ROBOT_TYPE: "device",
                        SN: sn,
                        TENANT_ID: tenantId,
                        USERNAME: sn
                    },
                    resetCode: 0,
                    maxUpgradeTime: 30
                }
            });
        });

        this.httpServer.on("request", app);

        this.httpServer.listen(KaercherAiotDummycloud.HTTP_PORT, this.bindIP, () => {
            Logger.info(`KaercherAiotDummycloud HTTPS listening on ${this.bindIP}:${KaercherAiotDummycloud.HTTP_PORT}`);
        });

        this.httpServer.on("error", (err) => {
            Logger.error("KaercherAiotDummycloud HTTP Server Error:", err);
        });
    }

    setupMQTT() {
        this.mqttBroker = createBroker();
        this.mqttServer = tls.createServer(this.tlsContext.getTLSOptions(), this.mqttBroker.handle);

        this.mqttServer.listen(KaercherAiotDummycloud.MQTT_PORT, this.bindIP, () => {
            Logger.info(`KaercherAiotDummycloud MQTT listening on ${this.bindIP}:${KaercherAiotDummycloud.MQTT_PORT}`);
        });

        this.mqttServer.on("error", (err) => {
            Logger.error("KaercherAiotDummycloud MQTT Server Error:", err);
        });

        this.mqttBroker.on("client", (client) => {
            Logger.info(`KaercherAiotDummycloud MQTT client connected: ${client.id}`);

            this.onConnected?.();
        });

        this.mqttBroker.on("clientDisconnect", (client) => {
            Logger.info(`KaercherAiotDummycloud MQTT client disconnected: ${client.id}`);
        });

        this.mqttBroker.on("publish", (packet, client) => {
            if (!client) {
                return; // messages without a client are our own outgoing publishCommand() calls
            }

            Logger.trace(`KaercherAiotDummycloud MQTT message on '${packet.topic}':`, packet.payload.toString());

            // The robot is authoritative about its own sn — every topic it publishes
            // already contains it, so learn it from traffic rather than relying solely
            // on the HTTP login body (login_server.py's login isn't guaranteed to
            // precede every reconnect, e.g. a cached-token MQTT reconnect).
            const topicSn = KaercherAiotDummycloud.SN_FROM_TOPIC(packet.topic);
            if (topicSn) {
                this.sn = topicSn;
            }

            let envelope;
            try {
                envelope = JSON.parse(packet.payload.toString());
            } catch (e) {
                Logger.warn(`KaercherAiotDummycloud failed to parse incoming message on '${packet.topic}'`, e);
                return;
            }

            this.onIncomingCloudMessage?.(packet.topic, envelope);
        });
    }

    /**
     * Publishes a command envelope to the robot.
     *
     * @param {string} suffix appended to the device topic, e.g. "service_invoke/start_station_act"
     * @param {string} method
     * @param {object} params
     * @return {Promise<void>}
     */
    publishCommand(suffix, method, params) {
        if (!this.sn) {
            return Promise.reject(new Error("KaercherAiotDummycloud: cannot publish, sn not yet known (no traffic or login seen from the robot)"));
        }

        return new Promise((resolve, reject) => {
            this.mqttBroker.publish({
                cmd: "publish",
                topic: KaercherAiotDummycloud.BUILD_DEVICE_TOPIC(this.sn, suffix),
                payload: KaercherAiotDummycloud.BUILD_ENVELOPE(method, params),
                qos: 0,
                retain: false,
                dup: false
            }, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }
}

/**
 * Extracts sn from a topic of the shape /mqtt/{product_id}/{sn}/thing/{suffix}.
 *
 * @param {string} topic
 * @return {string|null}
 */
KaercherAiotDummycloud.SN_FROM_TOPIC = function(topic) {
    const match = /^\/mqtt\/[^/]+\/([^/]+)\/thing\//.exec(topic);
    return match ? match[1] : null;
};

/**
 * Mirrors adapter.py's _device_topic(): /mqtt/{product_id}/{sn}/thing/{suffix}.
 *
 * @param {string} sn
 * @param {string} suffix
 * @return {string}
 */
KaercherAiotDummycloud.BUILD_DEVICE_TOPIC = function(sn, suffix) {
    return `/mqtt/${KaercherAiotDummycloud.PRODUCT_ID}/${sn}/thing/${suffix}`;
};

/**
 * Mirrors adapter.py's _envelope(): {method, msgId, tenantId, version, params}.
 *
 * @param {string} method
 * @param {object} params
 * @return {Buffer}
 */
KaercherAiotDummycloud.BUILD_ENVELOPE = function(method, params) {
    return Buffer.from(JSON.stringify({
        method: method,
        msgId: String(Date.now()),
        tenantId: KaercherAiotDummycloud.TENANT_ID,
        version: "3.0",
        params: params
    }));
};

KaercherAiotDummycloud.HTTP_PORT = 443;
KaercherAiotDummycloud.MQTT_PORT = 8883;
// Same idiom as Midea's BIND_IP (127.0.13.37): a fixed, greppable loopback-range
// address for karcher-cloud-switch.sh's route redirect to target, distinct from
// Midea's value in case both are ever present on the same install.
KaercherAiotDummycloud.BIND_IP = "127.0.13.38";
// karcher-home's Product.RCV5 / consts.TENANT_ID — this module only supports the RCV5.
KaercherAiotDummycloud.PRODUCT_ID = "1540149850806333440";
KaercherAiotDummycloud.TENANT_ID = "1528983614213726208";

module.exports = KaercherAiotDummycloud;
