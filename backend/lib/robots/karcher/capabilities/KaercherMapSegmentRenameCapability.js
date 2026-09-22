const Logger = require("../../../Logger");
const MapSegmentRenameCapability = require("../../../core/capabilities/MapSegmentRenameCapability");

/**
 * doc/PROTOCOL.md "Room management": `service.rename_room`, firmware-confirmed
 * via `parseRenameRoomReq` disassembly, `{map_id, room_id, room_name}` — matching
 * the app's own `AreaVM.renameRoom()` exactly. The app's own input dialog caps
 * custom names at 12 characters (`RobotDialogBottom.setLengthFilter(12)`) and
 * rejects empty names; both enforced here too, device-side length limits beyond
 * that are unconfirmed.
 *
 * No client-side name cache is needed (unlike Roborock, whose `name_segment`
 * requires resending every room's name every time): `rename_room` is a
 * single-room write, and the new name comes back on the next map upload —
 * `KaercherMapParser.js` already reads `RoomDataInfo.roomName` into the
 * segment's `metaData.name`.
 *
 * @extends MapSegmentRenameCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherMapSegmentRenameCapability extends MapSegmentRenameCapability {
    /**
     * @param {import("../../../entities/core/ValetudoMapSegment")} segment
     * @param {string} name
     * @returns {Promise<void>}
     */
    async renameSegment(segment, name) {
        if (!name || name.length > 12) {
            throw new Error("Invalid name. Max length 12");
        }

        const mapId = this.robot.ephemeralState.current_map_id;

        if (mapId === undefined) {
            throw new Error("Cannot rename room: current_map_id not yet known");
        }

        await this.robot.sendServiceInvoke("rename_room", {
            map_id: mapId,
            room_id: parseInt(segment.id, 10),
            room_name: name
        });

        this.robot.sendServiceInvoke("upload_by_maptype", {map_type: 0}).catch(e => {
            Logger.warn("KaercherMapSegmentRenameCapability: failed to request a map refresh", e);
        });
    }
}

module.exports = KaercherMapSegmentRenameCapability;
