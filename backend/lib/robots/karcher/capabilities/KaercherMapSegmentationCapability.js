const MapSegmentationCapability = require("../../../core/capabilities/MapSegmentationCapability");

/**
 * doc/PROTOCOL.md §5 "Notes on set_room_clean parameters": `room_ids` is an explicit
 * list — the same `set_room_clean` command KaercherBasicControlCapability uses for a
 * full-house start, just scoped to the selected segments. Iteration count / custom
 * order aren't supported by this command (matches the base class's default
 * getProperties(): min/max iterations 1, no custom order), so `options` is ignored.
 *
 * @extends MapSegmentationCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherMapSegmentationCapability extends MapSegmentationCapability {
    /**
     * @param {Array<import("../../../entities/core/ValetudoMapSegment")>} segments
     * @return {Promise<void>}
     */
    async executeSegmentAction(segments) {
        await this.robot.sendServiceInvoke("set_room_clean", {
            room_ids: segments.map(segment => parseInt(segment.id, 10)),
            ctrl_value: 1,
            clean_type: 0
        });
    }
}

module.exports = KaercherMapSegmentationCapability;
