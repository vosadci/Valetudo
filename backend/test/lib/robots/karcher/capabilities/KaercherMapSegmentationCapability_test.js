const assert = require("node:assert");
const { describe, it } = require("node:test");

const KaercherMapSegmentationCapability = require("../../../../../lib/robots/karcher/capabilities/KaercherMapSegmentationCapability");
const KaercherRCV5ValetudoRobot = require("../../../../../lib/robots/karcher/KaercherRCV5ValetudoRobot");
const ValetudoMapSegment = require("../../../../../lib/entities/core/ValetudoMapSegment");

const FAKE_CONFIG = {
    get: (key) => key === "embedded" ? false : undefined
};

function buildRobotWithMapId(mapId) {
    const robot = new KaercherRCV5ValetudoRobot({config: FAKE_CONFIG, valetudoEventStore: {}});

    if (mapId !== undefined) {
        robot.ephemeralState.current_map_id = mapId;
    }

    const sent = [];
    robot.sendServiceInvoke = async (name, params) => {
        sent.push({name: name, params: params});
    };

    return {robot: robot, sent: sent};
}

describe("KaercherMapSegmentationCapability", () => {
    it("throws when current_map_id is not yet known", async () => {
        const {robot} = buildRobotWithMapId(undefined);
        const capability = new KaercherMapSegmentationCapability({robot: robot});
        const segments = [new ValetudoMapSegment({id: "11"})];

        await assert.rejects(() => capability.executeSegmentAction(segments), /current_map_id/);
    });

    it("writes an ordered, repeat-aware room_preference table, then set_room_clean", async () => {
        const {robot, sent} = buildRobotWithMapId(7);
        const capability = new KaercherMapSegmentationCapability({robot: robot});
        const segments = [
            new ValetudoMapSegment({id: "12"}),
            new ValetudoMapSegment({id: "11"})
        ];

        await capability.executeSegmentAction(segments, {iterations: 3, customOrder: true});

        assert.strictEqual(sent.length, 2);
        assert.strictEqual(sent[0].name, "set_preference");
        assert.deepStrictEqual(sent[0].params, {
            map_id: 7,
            prefer_type: 1,
            room_preference: [
                [12, "", 0, 0, 1, 1, 2, 0, 1, 0, 0, 0],
                [11, "", 0, 0, 1, 1, 2, 0, 1, 0, 0, 0]
            ]
        });
        assert.strictEqual(sent[1].name, "set_room_clean");
        assert.deepStrictEqual(sent[1].params, {room_ids: [12, 11], ctrl_value: 1, clean_type: 0});
    });

    it("clamps iterations to the 1-3 range", async () => {
        const {robot, sent} = buildRobotWithMapId(1);
        const capability = new KaercherMapSegmentationCapability({robot: robot});
        const segments = [new ValetudoMapSegment({id: "5"})];

        await capability.executeSegmentAction(segments, {iterations: 99});

        assert.strictEqual(sent[0].params.room_preference[0][6], 2);
    });

    it("uses currently known mode/fan/water raw values, defaulting when unknown", async () => {
        const {robot, sent} = buildRobotWithMapId(1);
        robot.parseAndUpdateState({wind: 3, water: 2, mode: 2});
        const capability = new KaercherMapSegmentationCapability({robot: robot});
        const segments = [new ValetudoMapSegment({id: "5"})];

        await capability.executeSegmentAction(segments);

        const [, , , mode, wind, water] = sent[0].params.room_preference[0];
        assert.deepStrictEqual({mode: mode, wind: wind, water: water}, {mode: 2, wind: 3, water: 2});
    });

    it("defaults mode/fan/water to sane values when nothing has been learned yet", async () => {
        const {robot, sent} = buildRobotWithMapId(1);
        const capability = new KaercherMapSegmentationCapability({robot: robot});
        const segments = [new ValetudoMapSegment({id: "5"})];

        await capability.executeSegmentAction(segments);

        const [, , , mode, wind, water] = sent[0].params.room_preference[0];
        assert.deepStrictEqual({mode: mode, wind: wind, water: water}, {mode: 0, wind: 1, water: 1});
    });

    it("reports 1-3 iterations and custom order support", () => {
        const {robot} = buildRobotWithMapId(1);
        const capability = new KaercherMapSegmentationCapability({robot: robot});

        assert.deepStrictEqual(capability.getProperties(), {
            iterationCount: {min: 1, max: 3},
            customOrderSupport: true
        });
    });
});
