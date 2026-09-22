const KaercherConst = require("../KaercherConst");
const KaercherMapParser = require("../KaercherMapParser");
const Logger = require("../../../Logger");
const MapSegmentEditCapability = require("../../../core/capabilities/MapSegmentEditCapability");

/**
 * doc/PROTOCOL.md "Room management": `service.arrange_room` (merge) and
 * `service.split_room`, both firmware-confirmed via `parseArrangeRoomReq`/
 * `parseSplitRoomReq` disassembly, field names matching the app's own
 * `AreaVM.arrangeRoom()`/`splitRoom()` exactly. Merge is live-confirmed working
 * on a real RCV5 (2026-09-22).
 *
 * `arrange_room` takes `room_ids: [int, ...]` — the app itself only ever calls it
 * with exactly 2 (a client-side UI limit, `settings_map_tip_merge`, not a
 * device-enforced one), which lines up with `joinSegments()`'s own 2-segment
 * signature, so no extra cap is needed here. The app also requires the two rooms
 * to be adjacent (checked against its own room-link graph); this capability
 * doesn't reconstruct that graph and instead lets a merge of non-adjacent rooms
 * fail device-side. `sendServiceInvoke` doesn't await an ack, so a device-side
 * rejection currently fails silently rather than surfacing an error — a map
 * refresh with the rooms unchanged is the only symptom.
 *
 * `split_room` takes `split_points: [x1, y1, x2, y2]` — a straight cut line
 * through the room, world metres, same coordinate convention as
 * `set_virtual_wall`/`set_zone_points` (confirmed in the APK: `map_start_x = (x *
 * resolution) + minX`). Reuses `KaercherMapParser.VALETUDO_PIXELS_TO_WORLD`, the
 * same helper `CombinedVirtualRestrictionsCapability` uses.
 *
 * `lang` (both commands): the robot's own already-known language, used
 * device-side to generate a default name for the resulting room. `0` is not a
 * defined value in the app's own `LanguageHelper` enum (Chinese=1, English=2);
 * live-tested sending `0` produced a Chinese default room name ("房间3") after a
 * merge — `KaercherConst.LANGUAGE_TYPE_ENGLISH` (2) is the correct fallback.
 *
 * @extends MapSegmentEditCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherMapSegmentEditCapability extends MapSegmentEditCapability {
    /**
     * @param {import("../../../entities/core/ValetudoMapSegment")} segmentA
     * @param {import("../../../entities/core/ValetudoMapSegment")} segmentB
     * @returns {Promise<void>}
     */
    async joinSegments(segmentA, segmentB) {
        const mapId = this.robot.ephemeralState.current_map_id;

        if (mapId === undefined) {
            throw new Error("Cannot merge rooms: current_map_id not yet known");
        }

        await this.robot.sendServiceInvoke("arrange_room", {
            map_id: mapId,
            room_ids: [parseInt(segmentA.id, 10), parseInt(segmentB.id, 10)],
            lang: this.robot.ephemeralState.language ?? KaercherConst.LANGUAGE_TYPE_ENGLISH
        });

        this.requestMapRefresh();
    }

    /**
     * @param {import("../../../entities/core/ValetudoMapSegment")} segment
     * @param {object} pA
     * @param {number} pA.x
     * @param {number} pA.y
     * @param {object} pB
     * @param {number} pB.x
     * @param {number} pB.y
     * @returns {Promise<void>}
     */
    async splitSegment(segment, pA, pB) {
        const mapId = this.robot.ephemeralState.current_map_id;

        if (mapId === undefined) {
            throw new Error("Cannot split room: current_map_id not yet known");
        }

        const worldOrigin = this.robot.state.map?.metaData?.worldOrigin;

        if (!worldOrigin) {
            throw new Error("Cannot split room: no map with a known world origin yet");
        }

        const a = KaercherMapParser.VALETUDO_PIXELS_TO_WORLD(pA.x, pA.y, worldOrigin);
        const b = KaercherMapParser.VALETUDO_PIXELS_TO_WORLD(pB.x, pB.y, worldOrigin);

        await this.robot.sendServiceInvoke("split_room", {
            map_id: mapId,
            room_id: parseInt(segment.id, 10),
            split_points: [a.x, a.y, b.x, b.y],
            lang: this.robot.ephemeralState.language ?? KaercherConst.LANGUAGE_TYPE_ENGLISH
        });

        this.requestMapRefresh();
    }

    requestMapRefresh() {
        this.robot.sendServiceInvoke("upload_by_maptype", {map_type: 0}).catch(e => {
            Logger.warn("KaercherMapSegmentEditCapability: failed to request a map refresh", e);
        });
    }
}

module.exports = KaercherMapSegmentEditCapability;
