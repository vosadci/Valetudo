const assert = require("node:assert");
const { describe, it } = require("node:test");

const KaercherCarpetModeControlCapability = require("../../../../../lib/robots/karcher/capabilities/KaercherCarpetModeControlCapability");
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

describe("KaercherCarpetModeControlCapability", () => {
    it("isEnabled() reflects privacy.carpet_turbo", async () => {
        const capability = new KaercherCarpetModeControlCapability({robot: buildRobot({carpet_turbo: 1}).robot});
        assert.strictEqual(await capability.isEnabled(), true);
    });

    it("isEnabled() is false when carpet_turbo is 0", async () => {
        const capability = new KaercherCarpetModeControlCapability({robot: buildRobot({carpet_turbo: 0}).robot});
        assert.strictEqual(await capability.isEnabled(), false);
    });

    it("isEnabled() is false when privacy hasn't been seen yet", async () => {
        const capability = new KaercherCarpetModeControlCapability({robot: buildRobot(undefined).robot});
        assert.strictEqual(await capability.isEnabled(), false);
    });

    it("enable() sends privacy.carpet_turbo=1 and refreshes state", async () => {
        const {robot, sentPropertySet, propertyGetCalled} = buildRobot({carpet_turbo: 0});
        await new KaercherCarpetModeControlCapability({robot: robot}).enable();

        assert.deepStrictEqual(sentPropertySet, [{privacy: {carpet_turbo: 1}}]);
        assert.strictEqual(propertyGetCalled(), true);
    });

    it("disable() sends privacy.carpet_turbo=0", async () => {
        const {robot, sentPropertySet} = buildRobot({carpet_turbo: 1});
        await new KaercherCarpetModeControlCapability({robot: robot}).disable();

        assert.deepStrictEqual(sentPropertySet, [{privacy: {carpet_turbo: 0}}]);
    });
});
