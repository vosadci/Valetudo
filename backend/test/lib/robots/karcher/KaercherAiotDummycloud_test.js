const assert = require("node:assert");
const { describe, it } = require("node:test");

const KaercherAiotDummycloud = require("../../../../lib/robots/karcher/KaercherAiotDummycloud");

describe("KaercherAiotDummycloud", () => {
    describe("SN_FROM_TOPIC", () => {
        it("extracts sn from a well-formed device topic", () => {
            const sn = KaercherAiotDummycloud.SN_FROM_TOPIC("/mqtt/1540149850806333440/SG12345678/thing/event/property/post");

            assert.strictEqual(sn, "SG12345678");
        });

        it("returns null for a topic that doesn't match the expected shape", () => {
            const sn = KaercherAiotDummycloud.SN_FROM_TOPIC("$SYS/broker/clients/connected");

            assert.strictEqual(sn, null);
        });
    });

    describe("BUILD_DEVICE_TOPIC", () => {
        it("matches adapter.py's _device_topic() shape", () => {
            const topic = KaercherAiotDummycloud.BUILD_DEVICE_TOPIC("SG12345678", "service_invoke/start_station_act");

            assert.strictEqual(topic, "/mqtt/1540149850806333440/SG12345678/thing/service_invoke/start_station_act");
        });
    });

    describe("BUILD_ENVELOPE", () => {
        it("matches adapter.py's _envelope() shape", () => {
            const envelope = JSON.parse(KaercherAiotDummycloud.BUILD_ENVELOPE("thing.service_invoke.start_station_act", {station_type: 1}).toString());

            assert.strictEqual(envelope.method, "thing.service_invoke.start_station_act");
            assert.strictEqual(envelope.tenantId, KaercherAiotDummycloud.TENANT_ID);
            assert.strictEqual(envelope.version, "3.0");
            assert.deepStrictEqual(envelope.params, {station_type: 1});
            assert.match(envelope.msgId, /^\d+$/);
        });
    });

    describe("publishCommand", () => {
        it("rejects when sn isn't known yet (no login or inbound traffic seen)", async () => {
            const cloud = Object.create(KaercherAiotDummycloud.prototype);
            // Deliberately not calling the constructor (which would open real
            // HTTPS/MQTT servers) — this only exercises the sn guard.

            await assert.rejects(() => cloud.publishCommand("service_invoke/start_station_act", "x", {}));
        });
    });
});
