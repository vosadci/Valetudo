const CurrentStatisticsCapability = require("../../../core/capabilities/CurrentStatisticsCapability");
const ValetudoDataPoint = require("../../../entities/core/ValetudoDataPoint");

/**
 * doc/PROTOCOL.md §6: `cleaning_time` (minutes elapsed in the current session) and
 * `cleaning_area` (raw units of 0.01 m²) are pushed unprompted as part of the same
 * flat property object as everything else — no dedicated poll command exists — so
 * this reads from the robot's cached ephemeralState rather than issuing a fresh
 * request. Values are therefore as fresh as the last property push, not actively
 * polled.
 *
 * `quantity` is battery level (device-confirmed, doc/PROTOCOL.md §6), not a session
 * count — there is no COUNT-type statistic available on this robot.
 *
 * @extends CurrentStatisticsCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherCurrentStatisticsCapability extends CurrentStatisticsCapability {
    /**
     * @return {Promise<Array<ValetudoDataPoint>>}
     */
    async getStatistics() {
        const statistics = [];
        const {cleaning_time: cleaningTime, cleaning_area: cleaningArea} = this.robot.ephemeralState;

        if (cleaningTime !== undefined) {
            statistics.push(new ValetudoDataPoint({
                type: ValetudoDataPoint.TYPES.TIME,
                value: cleaningTime * 60 // minutes -> seconds
            }));
        }

        if (cleaningArea !== undefined) {
            statistics.push(new ValetudoDataPoint({
                type: ValetudoDataPoint.TYPES.AREA,
                value: cleaningArea * 100 // 0.01 m² units -> cm²
            }));
        }

        return statistics;
    }

    getProperties() {
        return {
            availableStatistics: [
                ValetudoDataPoint.TYPES.TIME,
                ValetudoDataPoint.TYPES.AREA
            ]
        };
    }
}

module.exports = KaercherCurrentStatisticsCapability;
