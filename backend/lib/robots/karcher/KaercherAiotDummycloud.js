const crypto = require("crypto");
const express = require("express");
const https = require("https");
const KaercherMqtt5Server = require("./KaercherMqtt5Server");
const Logger = require("../../Logger");

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
     * @param {(dir: string, body: Buffer) => void} [options.onSpecificUseUpload] called with
     *   the raw PUT body whenever the robot uploads a devlog or map object via the
     *   storage.specific_use_url/getAccessUrl flow
     */
    constructor(options) {
        this.tlsContext = options.tlsContext;
        this.bindIP = options.bindIP;
        this.onIncomingCloudMessage = options.onIncomingCloudMessage;
        this.onConnected = options.onConnected;
        this.onSpecificUseUpload = options.onSpecificUseUpload;

        this.setupHTTP();
        this.setupMQTT();
    }

    setupHTTP() {
        this.httpServer = https.createServer(this.tlsContext.getTLSOptions());

        const app = express();
        // aiot_client's login POST isn't guaranteed to set Content-Type: application/json
        // (unconfirmed either way); match login_server.py's unconditional json.loads()
        // rather than silently 200-ing with an empty body if it doesn't. Scoped per-route
        // (not app.use()) because the upload PUT route below needs the raw body instead.
        const jsonBody = express.json({type: () => true});

        app.post("/device-service/auth/login", jsonBody, (req, res) => {
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

        // Answered for both devlog (serviceType:4) and map (serviceType:2, temp/history)
        // uploads — see project_rcv5_valetudo_step7_live_confirmed memory. aiot_client
        // itself never inspects these fields, it just relays the whole reply to
        // RobotApp over the local IPC socket. RobotApp DOES care: a live test this
        // session showed it silently drops the upload (no curl attempt at all) when
        // `cdnDomain` is empty — the real cloud always sends a non-empty one
        // (`eu-cdnmapaiot.3irobotix.net` / `eu-cdndevlogaiot.3irobotix.net`), strongly
        // suggesting RobotApp builds its actual upload target from cdnDomain+dir rather
        // than blindly PUTing to `url`. Must be a hostname the device's /etc/hosts
        // redirect actually covers — reusing req.hostname (rather than mimicking the
        // real subdomain-per-purpose split) guarantees that, since it's by definition
        // the hostname that just reached us.
        app.post("/storage-management/storage/aws/getAccessUrl", jsonBody, (req, res) => {
            const {dir = ""} = req.body ?? {};

            Logger.debug(`KaercherAiotDummycloud: getAccessUrl for dir='${dir}'`);

            res.status(200).json({
                code: 0,
                result: {
                    accessid: "local",
                    bucket: "local",
                    bucketDomain: `https://${req.hostname}`,
                    cdnDomain: req.hostname,
                    dir: dir,
                    expire: "32400000",
                    host: "local",
                    // Real cloud responses always use a purely numeric id (e.g.
                    // "343813725915844608") — a UUID here was tried first and produced
                    // a silent no-op on RobotApp's side (parsed fine as JSON, but no
                    // upload was ever attempted), consistent with RobotApp parsing
                    // this field as an integer somewhere downstream.
                    id: KaercherAiotDummycloud.RANDOM_NUMERIC_ID(),
                    policy: "",
                    secret: "local",
                    signature: "",
                    // Real presigned URLs always carry an X-Amz-* query string; a bare
                    // path (tried first) is a plausible reject point if RobotApp
                    // expects/parses one. Cheap to match the shape even though our own
                    // catch-all PUT route (below) only reads `dir` from the path and
                    // ignores the query entirely.
                    url: `https://${req.hostname}/${dir}?X-Amz-Algorithm=AWS4-HMAC-SHA256&x-id=PutObject`,
                    urlType: "s3"
                }
            });
        });

        // The actual PUT the getAccessUrl reply above points at. Per step 7's live
        // capture, aiot_client itself never performs this PUT — RobotApp does, and
        // (per the cdnDomain finding above) may build the target URL itself from
        // cdnDomain+dir rather than using `url` verbatim — so this can't assume a
        // fixed path/query shape the way the first version did. Catches any PUT path
        // and reads `dir` from the path itself instead. Body passed on as a raw
        // Buffer, not decoded to a string here: karcher-home's decrypt_map() implies
        // the S3 object content is base64 text, but that's inferred from a GET
        // download path, never confirmed on a real PUT body — a wrong guess here
        // would silently mangle binary data. Let the consumer decide.
        app.put(/.*/, express.raw({type: () => true, limit: "5mb"}), (req, res) => {
            const dir = decodeURIComponent(req.path.replace(/^\//, ""));
            const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

            Logger.debug(`KaercherAiotDummycloud: received upload for dir='${dir}' (${body.length} bytes)`);

            this.onSpecificUseUpload?.(dir, body);

            res.status(200).send();
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
        this.mqttServer = new KaercherMqtt5Server({
            tlsContext: this.tlsContext,
            bindIP: this.bindIP,
            port: KaercherAiotDummycloud.MQTT_PORT,
            onConnected: () => this.onConnected?.(),
            onPublish: (topic, payload) => {
                // The robot is authoritative about its own sn — every topic it publishes
                // already contains it, so learn it from traffic rather than relying solely
                // on the HTTP login body (login_server.py's login isn't guaranteed to
                // precede every reconnect, e.g. a cached-token MQTT reconnect).
                const topicSn = KaercherAiotDummycloud.SN_FROM_TOPIC(topic);
                if (topicSn) {
                    this.sn = topicSn;
                }

                let envelope;
                try {
                    envelope = JSON.parse(payload.toString());
                } catch (e) {
                    Logger.warn(`KaercherAiotDummycloud failed to parse incoming message on '${topic}'`, e);
                    return;
                }

                this.onIncomingCloudMessage?.(topic, envelope);
            }
        });
    }

    /**
     * @return {Promise<void>}
     */
    async shutdown() {
        await new Promise((resolve) => {
            this.httpServer.close(() => {
                Logger.info("KaercherAiotDummycloud HTTPS server shut down");
                resolve();
            });
        });

        this.mqttServer.close();
    }

    /**
     * Publishes a command envelope to the robot.
     *
     * @param {string} suffix appended to the device topic, e.g. "service_invoke/start_station_act"
     * @param {string} method
     * @param {object} params
     * @param {string} [version] doc/PROTOCOL.md §5: service_invoke commands use "3.0",
     *   but prop.set (fan speed/water/cleaning mode, topic "service/property/set")
     *   uses "1.0" — confirmed by live capture, not just convention.
     * @return {Promise<void>}
     */
    publishCommand(suffix, method, params, version = "3.0") {
        if (!this.sn) {
            return Promise.reject(new Error("KaercherAiotDummycloud: cannot publish, sn not yet known (no traffic or login seen from the robot)"));
        }

        const sent = this.mqttServer.publish(
            KaercherAiotDummycloud.BUILD_DEVICE_TOPIC(this.sn, suffix),
            KaercherAiotDummycloud.BUILD_ENVELOPE(method, params, version)
        );

        if (!sent) {
            return Promise.reject(new Error("KaercherAiotDummycloud: cannot publish, no MQTT client connected"));
        }

        return Promise.resolve();
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
 * @param {string} [version] defaults to "3.0", the service_invoke shape — see
 *   publishCommand's own default for why prop.set needs "1.0" instead.
 * @return {Buffer}
 */
KaercherAiotDummycloud.BUILD_ENVELOPE = function(method, params, version = "3.0") {
    return Buffer.from(JSON.stringify({
        method: method,
        msgId: String(Date.now()),
        tenantId: KaercherAiotDummycloud.TENANT_ID,
        version: version,
        params: params
    }));
};

/**
 * An 18-digit random numeric string, matching the shape of real getAccessUrl `id`
 * values observed live (e.g. "343813725915844608").
 *
 * @return {string}
 */
KaercherAiotDummycloud.RANDOM_NUMERIC_ID = function() {
    let id = "";
    for (let i = 0; i < 18; i++) {
        id += crypto.randomInt(0, 10);
    }
    return id;
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
