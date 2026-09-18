const KaercherMapCrypto = require("./KaercherMapCrypto");
const Logger = require("../../Logger");
const mapEntities = require("../../entities/map");
const Protobufs = require("./generated/karcher_protobufs.js");

/**
 * Parses a raw map upload (the PUT body received by KaercherAiotDummycloud's
 * /_valetudo/karcherUpload for a map/temp/_1 object) into a Valetudo ValetudoMap.
 *
 * Wire format, outer to inner (see project_rcv5_valetudo_step7_live_confirmed memory
 * and doc/MAP_DATA.md §3/§4.2 in the karcher-rcv5-ha repo):
 *   PUT body (base64 text) -> AES-128-ECB decrypt -> zlib inflate -> RobotMap protobuf
 *   -> RobotMap.mapData.mapData: bare width*height grid bytes, full-resolution
 *      1-byte-per-cell format, no header (confirmed against a real fixture fetched via
 *      karcher-home: byte count matched size_x*size_y exactly, no room for the 6-byte
 *      header doc/PROTOCOL.md §13.3 describes for the separate upload_by_mapid MQTT
 *      channel — that header belongs to a different, QuickLZ-compressed delivery path).
 *
 * Only the `_1` temp suffix is parsed (confirmed authoritative: it's the one carrying
 * current_pose/history_pose and the newest map_upload_date; `_2` is an older,
 * pose-less snapshot with identical grid data; `_3` was empty in the one account
 * tested). `_2`/`_3` are not handled here — see KaercherAiotDummycloud's upload route.
 */
class KaercherMapParser {
    /**
     * @param {object} options
     * @param {string} options.sn
     * @param {string} options.mac
     * @param {string} options.productId
     */
    constructor(options) {
        this.sn = options.sn;
        this.mac = options.mac;
        this.productId = options.productId;
    }

    /**
     * @param {Buffer} rawUploadBody
     * @return {import("../../entities/map/ValetudoMap")|null}
     */
    parse(rawUploadBody) {
        let robotMap;
        try {
            // The PUT body is assumed to be base64 text, not raw binary — inferred from
            // karcher-home's decrypt_map() base64-decoding a GET download of the same
            // S3 object, and corroborated end-to-end: that GET+decrypt+decompress+
            // protobuf-parse chain was verified this session against a real map fetched
            // from the live cloud account, producing sensible content matching
            // doc/MAP_DATA.md §4.2's byte table exactly. Not yet confirmed byte-for-byte
            // on an actual PUT body from the robot itself.
            const decrypted = KaercherMapCrypto.DECRYPT_MAP(
                this.sn, this.mac, this.productId, rawUploadBody.toString("utf-8")
            );

            robotMap = Protobufs.decodeRobotMap(decrypted);
        } catch (e) {
            Logger.warn("KaercherMapParser: failed to decrypt/decode map upload", e);
            return null;
        }

        if (!robotMap.mapHead || !robotMap.mapData?.mapData) {
            Logger.warn("KaercherMapParser: map upload missing mapHead or mapData");
            return null;
        }

        return KaercherMapParser.BUILD_VALETUDO_MAP(robotMap);
    }

    /**
     * @param {object} robotMap decoded RobotMap protobuf message
     * @return {import("../../entities/map/ValetudoMap")|null}
     */
    static BUILD_VALETUDO_MAP(robotMap) {
        const head = robotMap.mapHead;
        const width = head.sizeX;
        const height = head.sizeY;
        const resolution = head.resolution;
        const gridBytes = robotMap.mapData.mapData;

        if (!(width > 0 && height > 0 && resolution > 0)) {
            Logger.warn(`KaercherMapParser: invalid map_head ${JSON.stringify(head)}`);
            return null;
        }
        if (gridBytes.length !== width * height) {
            Logger.warn(
                `KaercherMapParser: grid payload length ${gridBytes.length} != ${width}*${height}`
            );
            return null;
        }

        const pixels = {floor: [], wall: [], segments: {}};

        for (let row = 0; row < height; row++) {
            for (let col = 0; col < width; col++) {
                const cell = KaercherMapParser.DECODE_CELL(gridBytes[(row * width) + col]);
                if (cell.kind === "skip") {
                    continue;
                }

                // Image Y-axis is flipped relative to grid rows (doc/MAP_DATA.md §5):
                // grid row 0 = world min_y = image bottom.
                const coords = [col, height - 1 - row];

                if (cell.kind === "wall") {
                    pixels.wall.push(coords);
                } else if (cell.kind === "floor") {
                    pixels.floor.push(coords);
                } else {
                    (pixels.segments[cell.segmentId] ??= []).push(coords);
                }
            }
        }

        const layers = [];

        if (pixels.floor.length > 0) {
            layers.push(new mapEntities.MapLayer({
                pixels: pixels.floor.sort(mapEntities.MapLayer.COORDINATE_TUPLE_SORT).flat(),
                type: mapEntities.MapLayer.TYPE.FLOOR
            }));
        }
        if (pixels.wall.length > 0) {
            layers.push(new mapEntities.MapLayer({
                pixels: pixels.wall.sort(mapEntities.MapLayer.COORDINATE_TUPLE_SORT).flat(),
                type: mapEntities.MapLayer.TYPE.WALL
            }));
        }

        const roomsById = new Map((robotMap.roomDataInfo ?? []).map(r => [r.roomId, r]));
        Object.keys(pixels.segments).forEach((segmentIdStr) => {
            const segmentId = parseInt(segmentIdStr, 10);
            const room = roomsById.get(segmentId);
            const metaData = {segmentId: segmentIdStr};
            if (room?.roomName) {
                metaData.name = room.roomName;
            }

            layers.push(new mapEntities.MapLayer({
                pixels: pixels.segments[segmentIdStr].sort(mapEntities.MapLayer.COORDINATE_TUPLE_SORT).flat(),
                type: mapEntities.MapLayer.TYPE.SEGMENT,
                metaData: metaData
            }));
        });

        if (layers.length === 0) {
            Logger.warn("KaercherMapParser: no decodable pixels in this map upload");
            return null;
        }

        const entities = [];
        const toValetudo = (x, y) => KaercherMapParser.WORLD_TO_VALETUDO_PIXELS(x, y, head, resolution);

        if (robotMap.currentPose) {
            const {x, y, phi} = robotMap.currentPose;
            entities.push(new mapEntities.PointMapEntity({
                points: [toValetudo(x, y).x, toValetudo(x, y).y],
                metaData: {angle: KaercherMapParser.PHI_TO_VALETUDO_ANGLE(phi ?? 0)},
                type: mapEntities.PointMapEntity.TYPE.ROBOT_POSITION
            }));
        }

        if (robotMap.chargeStation && (robotMap.chargeStation.x !== 0 || robotMap.chargeStation.y !== 0)) {
            const {x, y, phi} = robotMap.chargeStation;
            entities.push(new mapEntities.PointMapEntity({
                points: [toValetudo(x, y).x, toValetudo(x, y).y],
                metaData: {angle: KaercherMapParser.PHI_TO_VALETUDO_ANGLE(phi ?? 0)},
                type: mapEntities.PointMapEntity.TYPE.CHARGER_LOCATION
            }));
        }

        const historyPoints = robotMap.historyPose?.points ?? [];
        if (historyPoints.length > 0) {
            const pathPoints = [];
            historyPoints.forEach((p) => {
                const c = toValetudo(p.x, p.y);
                pathPoints.push(c.x, c.y);
            });

            entities.push(new mapEntities.PathMapEntity({
                points: pathPoints,
                type: mapEntities.PathMapEntity.TYPE.PATH
            }));
        }

        return new mapEntities.ValetudoMap({
            metaData: {
                vendorMapId: head.mapHeadId
            },
            size: {
                x: width * KaercherMapParser.PIXEL_SIZE,
                y: height * KaercherMapParser.PIXEL_SIZE
            },
            pixelSize: KaercherMapParser.PIXEL_SIZE,
            layers: layers,
            entities: entities
        });
    }

    /**
     * Decodes a single grid byte per doc/MAP_DATA.md §4.2 (APK-verified, and confirmed
     * this session against a real fixture: byte value distribution matched exactly,
     * including room-id values lining up 1:1 with room_data_info entries).
     *
     * @param {number} byte
     * @return {{kind: "wall"|"floor"|"segment"|"skip", segmentId?: number}}
     */
    static DECODE_CELL(byte) {
        if (byte === 255) {
            return {kind: "wall"};
        }
        if (byte === 253) {
            // Carpet/second-pass cell outside any room.
            return {kind: "floor"};
        }
        if (byte >= 10 && byte <= 59) {
            // Unvisited room cell.
            return {kind: "segment", segmentId: byte};
        }
        if (byte >= 60 && byte <= 127) {
            // Cleaned room cell.
            return {kind: "segment", segmentId: byte - 50};
        }
        if (byte >= 147 && byte <= 196) {
            // Carpet/second-pass room cell.
            return {kind: "segment", segmentId: 206 - byte};
        }
        if (byte < 10) {
            switch (byte & 0x3) {
                case 1: // cleaned
                case 2: // deep-cleaned
                    return {kind: "floor"};
                case 3: // wall
                    return {kind: "wall"};
                default: // 0: free/unknown
                    return {kind: "skip"};
            }
        }
        // 128-146, 197-252, 254: unhandled by the app itself, no colour assigned.
        return {kind: "skip"};
    }

    /**
     * World metres (doc/MAP_DATA.md §5: origin bottom-left, Y up) to Valetudo pixel
     * coordinates (origin top-left, Y down, units of PIXEL_SIZE cm).
     *
     * @param {number} worldX
     * @param {number} worldY
     * @param {{sizeY: number, minX: number, minY: number}} head
     * @param {number} resolution metres/cell
     * @return {{x: number, y: number}}
     */
    static WORLD_TO_VALETUDO_PIXELS(worldX, worldY, head, resolution) {
        const col = (worldX - head.minX) / resolution;
        const rowFromBottom = (worldY - head.minY) / resolution;

        return {
            x: Math.round(col * KaercherMapParser.PIXEL_SIZE),
            y: Math.round((head.sizeY - rowFromBottom) * KaercherMapParser.PIXEL_SIZE)
        };
    }

    /**
     * Karcher's phi (doc/MAP_DATA.md §5): radians, 0 = east (+X), π/2 = north (+Y), CCW+,
     * in WORLD space. Valetudo's PointMapEntity angle: degrees, 0-360, 0° = north, in
     * (Y-flipped) screen space — same convention every other vendor parser in this repo
     * targets via `(mathDegrees + 90) % 360` (see MideaMapParser/RoborockMapParser). The
     * extra negation here accounts for the world->screen Y-flip that those vendors'
     * raw angle inputs were already expressed in but ours isn't — same transform this
     * project's own HA card uses for the identical phi convention (Kärcher
     * karcher-rcv5-ha `www/card/map-draw.js`: "Canvas target angle for world phi
     * (Y-flipped) = -phi").
     *
     * @param {number} phi radians
     * @return {number} degrees, 0-360, 0 = north
     */
    static PHI_TO_VALETUDO_ANGLE(phi) {
        const degrees = 90 - (phi * 180 / Math.PI);
        return ((degrees % 360) + 360) % 360;
    }
}

KaercherMapParser.PIXEL_SIZE = 5; // cm; matches the RCV5's 0.05m/cell grid resolution

module.exports = KaercherMapParser;
