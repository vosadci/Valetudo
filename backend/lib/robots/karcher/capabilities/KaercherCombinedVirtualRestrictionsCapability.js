const CombinedVirtualRestrictionsCapability = require("../../../core/capabilities/CombinedVirtualRestrictionsCapability");
const KaercherConst = require("../KaercherConst");
const KaercherMapParser = require("../KaercherMapParser");
const Logger = require("../../../Logger");
const ValetudoRestrictedZone = require("../../../entities/core/ValetudoRestrictedZone");

/**
 * doc/PROTOCOL.md "set_virtual_wall": `service_invoke/set_virtual_wall`,
 * `{"virwall": [<count>, [id, type, x1,y1,x2,y2,x3,y3,x4,y4], ...]}`.
 *
 * Decoded 2026-09-22 straight from the RCV5 `I3.12.90` firmware binary
 * (`RobotApp`, `everest::net::CAiotParseBuf::parseSetVirtualWallReq`,
 * `0x4ae0fc`), cross-validated against the decompiled APK (v1.4.32,
 * `WallSettingActivity`/`GlobalRender`) and `doc/MAP_DATA.md`'s independently
 * sourced `DeviceAreaDataInfo` protobuf descriptor.
 *
 * **No-mop send type is `6`, confirmed live (2026-09-22+).** The APK's own
 * UI code (`WallSettingActivity.java:161`, `addWallArea(true, 3)` →
 * `AreaMap.mCleanType` → `GlobalRender.getAreaDataNew():1293`) suggested `3`
 * on the send path, distinct from the device-capture-confirmed no-mop echo
 * code `6` (`doc/MAP_DATA.md` §6.7) — that static-analysis inference turned
 * out wrong. Live-tested: sending `3` rendered the zone as red (not the
 * distinct no-mop color) after save and the robot avoided it entirely
 * (no-go behavior, not mop-skip) — i.e. the device didn't recognize `3` and
 * fell back to no-go on both the read side (`KaercherMapParser`'s own
 * fallthrough: anything that isn't `type 6` renders as `NO_GO_AREA`) and,
 * apparently, in whatever algorithm consumer actually decides avoidance
 * behavior. Sending `6` (the same value used and confirmed on the read/echo
 * side) is what actually works. `parseSetVirtualWallReq` copies `wall[1]`
 * straight into `DeviceAreaDataInfo.type` with no remapping, so this is
 * simply the correct value, not a re-code. No-go (`1`) and line wall (`2`)
 * were correct as originally derived. A wall (2 real endpoints) still needs
 * all 4 point slots filled; the read side found the real device duplicates
 * each endpoint (`[A, A, B, B]`) rather than sending 2 points, so the same
 * shape is mirrored here on the way out — also live-confirmed working
 * (add/edit/delete all verified end-to-end for walls and zones).
 *
 * **Add, edit, and delete are all live-confirmed working (2026-09-22).**
 * Re-sending an existing `areaindex` with new points updates it in place —
 * `status`/`map_id`/`type` on the wire protobuf are all hardcoded constants
 * on the device side, never read from this payload. No explicit delete
 * opcode was ever found in the decoded firmware path, so this capability
 * follows the same full desired-state-replace design Roborock's `save_map`
 * uses (`RoborockCombinedVirtualRestrictionsCapability`): every call
 * re-sends the *entire* current set of walls/zones with freshly assigned
 * sequential ids, one `set_virtual_wall` call fully replacing what's
 * registered for the map. Live testing confirmed this is exactly right —
 * omitting a previously-sent `areaindex` does delete it device-side, for
 * both walls and zones.
 *
 * Coordinate transform: reuses `KaercherMapParser.VALETUDO_PIXELS_TO_WORLD`,
 * the same helper `KaercherZoneCleaningCapability` uses. Live-confirmed
 * correct here (zones land where drawn, robot avoids the right area) —
 * strong evidence `KaercherZoneCleaningCapability`'s own use of the same
 * transform is also correct, though that capability hasn't been separately
 * live-tested itself.
 *
 * @extends CombinedVirtualRestrictionsCapability<import("../KaercherRCV5ValetudoRobot")>
 */
class KaercherCombinedVirtualRestrictionsCapability extends CombinedVirtualRestrictionsCapability {
    /**
     * @param {object} options
     * @param {import("../KaercherRCV5ValetudoRobot")} options.robot
     */
    constructor(options) {
        super({
            robot: options.robot,
            supportedRestrictedZoneTypes: [
                ValetudoRestrictedZone.TYPE.REGULAR,
                ValetudoRestrictedZone.TYPE.MOP
            ]
        });
    }

    /**
     * @param {import("../../../entities/core/ValetudoVirtualRestrictions")} virtualRestrictions
     * @returns {Promise<void>}
     */
    async setVirtualRestrictions(virtualRestrictions) {
        const worldOrigin = this.robot.state.map?.metaData?.worldOrigin;

        if (!worldOrigin) {
            throw new Error("Cannot set virtual restrictions: no map with a known world origin yet");
        }

        const totalCount = virtualRestrictions.virtualWalls.length + virtualRestrictions.restrictedZones.length;

        // App-confirmed cap (WallSettingActivity.java settings_wall_max_number,
        // v1.4.32) — surfaced as a real error rather than silently truncated.
        if (totalCount > KaercherCombinedVirtualRestrictionsCapability.MAX_AREAS) {
            throw new Error(
                "Cannot set virtual restrictions: the robot supports at most " +
                `${KaercherCombinedVirtualRestrictionsCapability.MAX_AREAS} walls/zones combined, got ${totalCount}`
            );
        }

        const toWorld = (point) => {
            return KaercherMapParser.VALETUDO_PIXELS_TO_WORLD(point.x, point.y, worldOrigin);
        };

        let nextId = 1;
        const areas = [];

        virtualRestrictions.virtualWalls.forEach(wall => {
            const a = toWorld(wall.points.pA);
            const b = toWorld(wall.points.pB);

            areas.push([
                nextId++,
                KaercherConst.ZONE_TYPE_WALL,
                a.x, a.y,
                a.x, a.y,
                b.x, b.y,
                b.x, b.y
            ]);
        });

        virtualRestrictions.restrictedZones.forEach(zone => {
            const type = zone.type === ValetudoRestrictedZone.TYPE.MOP ?
                KaercherConst.ZONE_TYPE_NOMOP :
                KaercherConst.ZONE_TYPE_NOGO;

            const a = toWorld(zone.points.pA);
            const b = toWorld(zone.points.pB);
            const c = toWorld(zone.points.pC);
            const d = toWorld(zone.points.pD);

            areas.push([
                nextId++,
                type,
                a.x, a.y,
                b.x, b.y,
                c.x, c.y,
                d.x, d.y
            ]);
        });

        await this.robot.sendServiceInvoke("set_virtual_wall", {virwall: [areas.length, ...areas]});

        // The device doesn't proactively echo a map refresh after this write —
        // same reasoning as the connect-time upload_by_maptype request in
        // KaercherRCV5ValetudoRobot's constructor.
        this.robot.sendServiceInvoke("upload_by_maptype", {map_type: 0}).catch(e => {
            Logger.warn("KaercherCombinedVirtualRestrictionsCapability: failed to request a map refresh", e);
        });
    }
}

// App-confirmed (WallSettingActivity.java, v1.4.32): settings_wall_max_number.
KaercherCombinedVirtualRestrictionsCapability.MAX_AREAS = 10;

module.exports = KaercherCombinedVirtualRestrictionsCapability;
