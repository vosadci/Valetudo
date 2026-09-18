const BasicControlCapability = require("../../../core/capabilities/BasicControlCapability");

/**
 * doc/PROTOCOL.md §5: start/pause/stop all go through the same `set_room_clean`
 * service_invoke, distinguished only by `ctrl_value` (1=start/resume, 2=pause,
 * 0=stop-to-idle, all device-verified). `room_ids: []` does NOT mean "all rooms" —
 * the firmware picks one room semi-randomly — so a full-house start explicitly
 * passes every currently known room id.
 *
 * Zone (rectangle) cleaning is out of scope here: doc/PROTOCOL.md flags
 * `set_zone_points`/`set_zone_clean` as APK-derived, not device-capture-verified,
 * and pause/stop would need to route through them instead while a zone clean is
 * active — not handled by this capability.
 *
 * @extends BasicControlCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherBasicControlCapability extends BasicControlCapability {
    /**
     * @return {Promise<void>}
     */
    async start() {
        const roomIds = this.robot.state.map.getSegments().map(segment => parseInt(segment.id, 10));

        await this.robot.sendServiceInvoke("set_room_clean", {
            room_ids: roomIds,
            ctrl_value: 1,
            clean_type: 0
        });
    }

    /**
     * @return {Promise<void>}
     */
    async stop() {
        await this.robot.sendServiceInvoke("set_room_clean", {
            room_ids: [],
            ctrl_value: 0,
            clean_type: 0
        });
    }

    /**
     * @return {Promise<void>}
     */
    async pause() {
        await this.robot.sendServiceInvoke("set_room_clean", {
            room_ids: [],
            ctrl_value: 2,
            clean_type: 0
        });
    }

    /**
     * @return {Promise<void>}
     */
    async home() {
        await this.robot.sendServiceInvoke("start_recharge", {});
    }
}

module.exports = KaercherBasicControlCapability;
