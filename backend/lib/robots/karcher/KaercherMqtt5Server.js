const Logger = require("../../Logger");
const mqttPacket = require("mqtt-packet");
const tls = require("tls");

/**
 * Minimal single-client MQTT 5 server built directly on mqtt-packet. aedes (Valetudo's
 * usual MQTT broker dependency, used by Midea's dummycloud) has no MQTT5 support at
 * all (confirmed against its latest release, 1.2.0 — "not support yet" in its own
 * README), and the RCV5's aiot_client hard-requires MQTT5 (Eclipse Paho C client,
 * live-confirmed sending "CONNECT version 5"). This only implements what a single
 * always-connected client needs — CONNECT/CONNACK, SUBSCRIBE/SUBACK, PUBLISH both
 * directions, PINGREQ/PINGRESP, DISCONNECT — no retained messages, wildcards, or
 * multi-client routing, since there is never more than one client.
 */
class KaercherMqtt5Server {
    /**
     * @param {object} options
     * @param {import("./KaercherStaticTLSContext")} options.tlsContext
     * @param {string} options.bindIP
     * @param {number} options.port
     * @param {(topic: string, payload: Buffer) => void} [options.onPublish]
     * @param {(clientId: string) => void} [options.onConnected]
     */
    constructor(options) {
        this.onPublish = options.onPublish;
        this.onConnected = options.onConnected;
        this.socket = null;

        this.server = tls.createServer(options.tlsContext.getTLSOptions(), (socket) => this._handleSocket(socket));

        this.server.listen(options.port, options.bindIP, () => {
            Logger.info(`KaercherMqtt5Server listening on ${options.bindIP}:${options.port}`);
        });

        this.server.on("error", (err) => {
            Logger.error("KaercherMqtt5Server Error:", err);
        });
    }

    _handleSocket(socket) {
        const parser = mqttPacket.parser({protocolVersion: 5});

        parser.on("packet", (packet) => this._handlePacket(socket, packet));
        parser.on("error", (err) => {
            Logger.warn("KaercherMqtt5Server parse error:", err);
            socket.destroy();
        });

        socket.on("data", (data) => parser.parse(data));
        socket.on("close", () => {
            if (this.socket === socket) {
                this.socket = null;
            }
        });
        socket.on("error", (err) => {
            Logger.warn("KaercherMqtt5Server socket error:", err);
        });
    }

    _handlePacket(socket, packet) {
        switch (packet.cmd) {
            case "connect":
                this.socket = socket;
                this._write(socket, {cmd: "connack", reasonCode: 0, sessionPresent: false, properties: {}});
                Logger.info(`KaercherMqtt5Server client connected: ${packet.clientId}`);
                this.onConnected?.(packet.clientId);
                break;
            case "subscribe":
                this._write(socket, {
                    cmd: "suback",
                    messageId: packet.messageId,
                    granted: packet.subscriptions.map(() => 0),
                    properties: {}
                });
                break;
            case "publish":
                Logger.trace(`KaercherMqtt5Server message on '${packet.topic}':`, packet.payload.toString());

                this.onPublish?.(packet.topic, packet.payload);

                if (packet.qos > 0) {
                    this._write(socket, {cmd: "puback", messageId: packet.messageId, reasonCode: 0, properties: {}});
                }
                break;
            case "pingreq":
                this._write(socket, {cmd: "pingresp"});
                break;
            case "disconnect":
                socket.end();
                break;
            default:
                Logger.warn(`KaercherMqtt5Server unhandled packet type: ${packet.cmd}`);
        }
    }

    _write(socket, packet) {
        socket.write(mqttPacket.generate(packet, {protocolVersion: 5}));
    }

    /**
     * @param {string} topic
     * @param {Buffer} payload
     * @return {boolean} whether a client was connected to publish to
     */
    publish(topic, payload) {
        if (!this.socket) {
            return false;
        }

        this._write(this.socket, {cmd: "publish", topic: topic, payload: payload, qos: 0, retain: false, properties: {}});
        return true;
    }

    close() {
        this.server.close();
    }
}

module.exports = KaercherMqtt5Server;
