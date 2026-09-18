const assert = require("node:assert");
const { describe, it } = require("node:test");

const KaercherRCV5ValetudoRobot = require("../../../../lib/robots/karcher/KaercherRCV5ValetudoRobot");

// embedded: false skips dummycloud construction entirely (no TLS file reads, no port
// binds) — the same mode util/generate_robot_docs.js uses to instantiate robot
// classes without real hardware.
const FAKE_CONFIG = {
    get: (key) => key === "embedded" ? false : undefined
};

function buildRobot() {
    return new KaercherRCV5ValetudoRobot({config: FAKE_CONFIG, valetudoEventStore: {}});
}

describe("KaercherRCV5ValetudoRobot", () => {
    it("instantiates and registers the expected capabilities without a dummycloud", () => {
        const robot = buildRobot();

        assert.deepStrictEqual(
            Object.keys(robot.capabilities).sort(),
            [
                "BasicControlCapability",
                "ConsumableMonitoringCapability",
                "FanSpeedControlCapability",
                "MapSegmentationCapability",
                "WaterUsageControlCapability"
            ]
        );
        assert.strictEqual(robot.dummycloud, undefined);
    });

    it("keeps the last known battery level when charge_state/fault change in a push without quantity", () => {
        // Regression test: charge_state and quantity arrive in separate partial
        // pushes (doc/PROTOCOL.md §6), but both affect the battery flag. An earlier
        // version of parseAndUpdateState only recomputed the flag when `quantity`
        // was present in the same push, leaving a docked+charge-finish push with no
        // quantity field stuck showing "discharging".
        const robot = buildRobot();

        robot.parseAndUpdateState({quantity: 87, charge_state: 0, fault: 0});
        let battery = robot.state.getFirstMatchingAttribute({attributeClass: "BatteryStateAttribute"});
        assert.strictEqual(battery.level, 87);
        assert.strictEqual(battery.flag, "discharging");

        robot.parseAndUpdateState({status: 4, work_mode: 0, charge_state: 1, fault: 2105});
        battery = robot.state.getFirstMatchingAttribute({attributeClass: "BatteryStateAttribute"});
        assert.strictEqual(battery.level, 87, "level should be carried over from the last push that had it");
        assert.strictEqual(battery.flag, "charged");
    });

    it("maps wind/water prop.post pushes onto fan speed / water grade preset attributes", () => {
        const robot = buildRobot();

        robot.parseAndUpdateState({wind: 3, water: 2});

        const fanSpeed = robot.state.getFirstMatchingAttribute({
            attributeClass: "PresetSelectionStateAttribute",
            attributeType: "fan_speed"
        });
        const waterGrade = robot.state.getFirstMatchingAttribute({
            attributeClass: "PresetSelectionStateAttribute",
            attributeType: "water_grade"
        });

        assert.strictEqual(fanSpeed.value, "max");
        assert.strictEqual(waterGrade.value, "high");
    });

    describe("IMPLEMENTATION_AUTO_DETECTION_HANDLER", () => {
        it("returns false rather than throwing when productMode.ini doesn't exist", () => {
            assert.strictEqual(KaercherRCV5ValetudoRobot.IMPLEMENTATION_AUTO_DETECTION_HANDLER(), false);
        });
    });
});
