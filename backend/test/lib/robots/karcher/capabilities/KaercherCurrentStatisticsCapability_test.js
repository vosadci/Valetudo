const assert = require("node:assert");
const { describe, it } = require("node:test");

const KaercherCurrentStatisticsCapability = require("../../../../../lib/robots/karcher/capabilities/KaercherCurrentStatisticsCapability");
const KaercherRCV5ValetudoRobot = require("../../../../../lib/robots/karcher/KaercherRCV5ValetudoRobot");
const ValetudoDataPoint = require("../../../../../lib/entities/core/ValetudoDataPoint");

const FAKE_CONFIG = {
    get: (key) => key === "embedded" ? false : undefined
};

function buildRobot() {
    return new KaercherRCV5ValetudoRobot({config: FAKE_CONFIG, valetudoEventStore: {}});
}

describe("KaercherCurrentStatisticsCapability", () => {
    it("returns nothing before any property push has been received", async () => {
        const robot = buildRobot();
        const capability = new KaercherCurrentStatisticsCapability({robot: robot});

        assert.deepStrictEqual(await capability.getStatistics(), []);
    });

    it("converts cleaning_time (minutes) and cleaning_area (0.01 m² units) to seconds and cm²", async () => {
        const robot = buildRobot();
        const capability = new KaercherCurrentStatisticsCapability({robot: robot});

        robot.parseAndUpdateState({cleaning_time: 12, cleaning_area: 2228});

        const statistics = await capability.getStatistics();

        assert.deepStrictEqual(statistics.map(dp => ({type: dp.type, value: dp.value})), [
            {type: ValetudoDataPoint.TYPES.TIME, value: 720},
            {type: ValetudoDataPoint.TYPES.AREA, value: 222800}
        ]);
    });

    it("reports TIME and AREA as available statistics", () => {
        const robot = buildRobot();
        const capability = new KaercherCurrentStatisticsCapability({robot: robot});

        assert.deepStrictEqual(capability.getProperties(), {
            availableStatistics: [ValetudoDataPoint.TYPES.TIME, ValetudoDataPoint.TYPES.AREA]
        });
    });
});
