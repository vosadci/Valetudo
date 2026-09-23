const assert = require("node:assert");
const { describe, it } = require("node:test");

const KaercherObstacleAvoidanceControlCapability = require("../../../../../lib/robots/karcher/capabilities/KaercherObstacleAvoidanceControlCapability");
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

describe("KaercherObstacleAvoidanceControlCapability", () => {
    it("isEnabled() reflects privacy.ai_recognize", async () => {
        const capability = new KaercherObstacleAvoidanceControlCapability({robot: buildRobot({ai_recognize: 1}).robot});
        assert.strictEqual(await capability.isEnabled(), true);
    });

    it("isEnabled() is false when ai_recognize is 0 or privacy is unknown", async () => {
        const zero = new KaercherObstacleAvoidanceControlCapability({robot: buildRobot({ai_recognize: 0}).robot});
        assert.strictEqual(await zero.isEnabled(), false);

        const unknown = new KaercherObstacleAvoidanceControlCapability({robot: buildRobot(undefined).robot});
        assert.strictEqual(await unknown.isEnabled(), false);
    });

    it("enable()/disable() send privacy.ai_recognize and refresh state", async () => {
        const {robot, sentPropertySet, propertyGetCalled} = buildRobot({ai_recognize: 0});
        const capability = new KaercherObstacleAvoidanceControlCapability({robot: robot});

        await capability.enable();
        await capability.disable();

        assert.deepStrictEqual(sentPropertySet, [
            {privacy: {ai_recognize: 1}},
            {privacy: {ai_recognize: 0}}
        ]);
        assert.strictEqual(propertyGetCalled(), true);
    });

    it("getProperties() exposes the map parser's known AI object type labels", () => {
        const capability = new KaercherObstacleAvoidanceControlCapability({robot: buildRobot(undefined).robot});
        const properties = capability.getProperties();

        assert.ok(Array.isArray(properties.detectableTypes));
        assert.ok(properties.detectableTypes.includes("Sock"));
        assert.ok(properties.detectableTypes.includes("Pet waste"));
    });
});
