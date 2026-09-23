const assert = require("node:assert");
const { describe, it } = require("node:test");

const KaercherCarpetSensorModeControlCapability = require("../../../../../lib/robots/karcher/capabilities/KaercherCarpetSensorModeControlCapability");
const KaercherRCV5ValetudoRobot = require("../../../../../lib/robots/karcher/KaercherRCV5ValetudoRobot");

const FAKE_CONFIG = {
    get: (key) => key === "embedded" ? false : undefined
};

function buildRobot(privacy) {
    const robot = new KaercherRCV5ValetudoRobot({config: FAKE_CONFIG, valetudoEventStore: {}});

    robot.ephemeralState.privacy = privacy;

    const sentPropertySet = [];
    robot.sendPropertySet = async (params) => {
        sentPropertySet.push(params);
    };
    let propertyGetCalled = false;
    robot.sendPropertyGet = async () => {
        propertyGetCalled = true;
    };

    return {robot: robot, sentPropertySet: sentPropertySet, propertyGetCalled: () => propertyGetCalled};
}

describe("KaercherCarpetSensorModeControlCapability", () => {
    it("getProperties() only advertises off/avoid (no lift/detach mechanism on the RCV5)", () => {
        const capability = new KaercherCarpetSensorModeControlCapability({robot: buildRobot(undefined).robot});
        assert.deepStrictEqual(capability.getProperties(), {supportedModes: ["off", "avoid"]});
    });

    it("getMode() maps carpet_avoid=1 to 'avoid'", async () => {
        const capability = new KaercherCarpetSensorModeControlCapability({robot: buildRobot({carpet_avoid: 1}).robot});
        assert.strictEqual(await capability.getMode(), "avoid");
    });

    it("getMode() maps carpet_avoid=0 (or unknown) to 'off'", async () => {
        const zero = new KaercherCarpetSensorModeControlCapability({robot: buildRobot({carpet_avoid: 0}).robot});
        assert.strictEqual(await zero.getMode(), "off");

        const unknown = new KaercherCarpetSensorModeControlCapability({robot: buildRobot(undefined).robot});
        assert.strictEqual(await unknown.getMode(), "off");
    });

    it("setMode('avoid') sends privacy.carpet_avoid=1 and refreshes state", async () => {
        const {robot, sentPropertySet, propertyGetCalled} = buildRobot({carpet_avoid: 0});
        await new KaercherCarpetSensorModeControlCapability({robot: robot}).setMode("avoid");

        assert.deepStrictEqual(sentPropertySet, [{privacy: {carpet_avoid: 1}}]);
        assert.strictEqual(propertyGetCalled(), true);
    });

    it("setMode('off') sends privacy.carpet_avoid=0", async () => {
        const {robot, sentPropertySet} = buildRobot({carpet_avoid: 1});
        await new KaercherCarpetSensorModeControlCapability({robot: robot}).setMode("off");

        assert.deepStrictEqual(sentPropertySet, [{privacy: {carpet_avoid: 0}}]);
    });

    it("setMode() rejects unsupported modes ('lift'/'detach')", async () => {
        const {robot} = buildRobot({carpet_avoid: 0});
        const capability = new KaercherCarpetSensorModeControlCapability({robot: robot});

        await assert.rejects(() => capability.setMode("lift"));
        await assert.rejects(() => capability.setMode("detach"));
    });
});
