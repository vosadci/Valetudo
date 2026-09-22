const CombinedVirtualRestrictionsCapability = require("../../../core/capabilities/CombinedVirtualRestrictionsCapability");
const KaercherConst = require("../KaercherConst");
const KaercherMapParser = require("../KaercherMapParser");
const Logger = require("../../../Logger");
const ValetudoRestrictedZone = require("../../../entities/core/ValetudoRestrictedZone");

/**
 * doc/PROTOCOL.md "set_virtual_wall": `service_invoke/set_virtual_wall`,
 * `{"virwall": [<count>, [id, type, x1,y1,x2,y2,x3,y3,x4,y4], ...]}`.
 * `type`: `1`=no-go, `2`=line wall, `6`=no-mop — same codes on both the
 * send and read/echo sides. A wall (2 logical endpoints) still fills all
 * 4 point slots, each endpoint duplicated (`[A, A, B, B]`), matching what
 * the device itself sends on the read side.
 *
 * Add, edit, and delete of line walls, no-go areas, and no-mop areas are
 * all live-confirmed working end-to-end against a real RCV5. Re-sending an
 * existing `areaindex` with new points updates it in place. There's no
 * separate delete opcode — this capability follows a full desired-state-
 * replace design, the same pattern Roborock's `save_map` uses
 * (`RoborockCombinedVirtualRestrictionsCapability`): every call re-sends
 * the *entire* current set of walls/zones with freshly assigned sequential
 * ids, and omitting a previously-sent `areaindex` deletes it device-side.
 *
 * Coordinate transform: reuses `KaercherMapParser.VALETUDO_PIXELS_TO_WORLD`,
 * the same helper `KaercherZoneCleaningCapability` uses.
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
