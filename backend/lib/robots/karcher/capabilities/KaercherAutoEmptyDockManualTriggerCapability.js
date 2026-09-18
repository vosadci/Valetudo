const AutoEmptyDockManualTriggerCapability = require("../../../core/capabilities/AutoEmptyDockManualTriggerCapability");

/**
 * Suction Station RCV 5 (part 22696430, sold separately). Device-confirmed
 * command, karcher-rcv5-ha's project_auto_empty_dock memory: manual empty is
 * `service.start_station_act` -> `{station_act: 3, ctrl_value: 1}`. The reply
 * arrived twice for one publish on real hardware, so this is idempotent by
 * construction (no local state to double-apply).
 *
 * @extends AutoEmptyDockManualTriggerCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherAutoEmptyDockManualTriggerCapability extends AutoEmptyDockManualTriggerCapability {
    /**
     * @return {Promise<void>}
     */
    async triggerAutoEmpty() {
        await this.robot.sendServiceInvoke("start_station_act", {station_act: 3, ctrl_value: 1});
    }
}

module.exports = KaercherAutoEmptyDockManualTriggerCapability;
