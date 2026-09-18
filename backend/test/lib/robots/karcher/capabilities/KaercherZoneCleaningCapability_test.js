const assert = require("node:assert");
const { describe, it } = require("node:test");

const KaercherRCV5ValetudoRobot = require("../../../../../lib/robots/karcher/KaercherRCV5ValetudoRobot");
const KaercherZoneCleaningCapability = require("../../../../../lib/robots/karcher/capabilities/KaercherZoneCleaningCapability");
const ValetudoZone = require("../../../../../lib/entities/core/ValetudoZone");

const FAKE_CONFIG = {
    get: (key) => key === "embedded" ? false : undefined
};

const WORLD_ORIGIN = {minX: 0, minY: 0, sizeY: 100, resolution: 0.05};

function buildRobot(worldOrigin) {
    const robot = new KaercherRCV5ValetudoRobot({config: FAKE_CONFIG, valetudoEventStore: {}});

    if (worldOrigin !== undefined) {
        robot.state.map = {metaData: {worldOrigin: worldOrigin}};
    }

    const sent = [];
    robot.sendServiceInvoke = async (name, params) => {
        sent.push({name: name, params: params});
    };

    return {robot: robot, sent: sent};
}

function buildZone() {
    return new ValetudoZone({
        points: {
            pA: {x: 100, y: 50},
            pB: {x: 200, y: 50},
            pC: {x: 200, y: 150},
            pD: {x: 100, y: 150}
        }
    });
}

describe("KaercherZoneCleaningCapability", () => {
    it("throws when the current map has no known world origin yet", async () => {
        const {robot} = buildRobot(undefined);
        const capability = new KaercherZoneCleaningCapability({robot: robot});

        await assert.rejects(
            () => capability.start({zones: [buildZone()]}),
            /world origin/
        );
    });

    it("throws when given more than one zone", async () => {
        const {robot} = buildRobot(WORLD_ORIGIN);
        const capability = new KaercherZoneCleaningCapability({robot: robot});

        await assert.rejects(
            () => capability.start({zones: [buildZone(), buildZone()]}),
            /single zone/
        );
    });

    it("converts the zone's Valetudo cm corners to world metres and sends both commands in order", async () => {
        const {robot, sent} = buildRobot(WORLD_ORIGIN);
        const capability = new KaercherZoneCleaningCapability({robot: robot});

        await capability.start({zones: [buildZone()]});

        assert.strictEqual(sent.length, 2);
        assert.strictEqual(sent[0].name, "set_zone_points");
        // Hand-computed against WORLD_ORIGIN={minX:0,minY:0,sizeY:100,resolution:0.05}:
        // col = x/5, worldX = col*0.05; rowFromBottom = 100-y/5, worldY = rowFromBottom*0.05.
        assert.deepStrictEqual(sent[0].params, {
            zone_points: [1.0, 4.5, 2.0, 4.5, 2.0, 3.5, 1.0, 3.5]
        });
        assert.strictEqual(sent[1].name, "set_zone_clean");
        assert.deepStrictEqual(sent[1].params, {ctrl_value: 1});
    });

    it("reports single-zone, single-iteration support only", () => {
        const {robot} = buildRobot(WORLD_ORIGIN);
        const capability = new KaercherZoneCleaningCapability({robot: robot});

        assert.deepStrictEqual(capability.getProperties(), {
            zoneCount: {min: 1, max: 1},
            iterationCount: {min: 1, max: 1}
        });
    });
});
