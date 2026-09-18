const fs = require("fs");

const capabilities = require("./capabilities");
const entities = require("../../entities");
const KaercherAiotDummycloud = require("./KaercherAiotDummycloud");
const KaercherConst = require("./KaercherConst");
const KaercherMapParser = require("./KaercherMapParser");
const KaercherStateDerivation = require("./KaercherStateDerivation");
const KaercherStaticTLSContext = require("./KaercherStaticTLSContext");
const Logger = require("../../Logger");
const ValetudoRobot = require("../../core/ValetudoRobot");
const ValetudoRobotError = require("../../entities/core/ValetudoRobotError");

const stateAttrs = entities.state.attributes;

class KaercherRCV5ValetudoRobot extends ValetudoRobot {
    /**
     * @param {object} options
     * @param {import("../../Configuration")} options.config
     * @param {import("../../ValetudoEventStore")} options.valetudoEventStore
     */
    constructor(options) {
        super(options);

        // Same fields the work_mode/status decision tree and battery flag need,
        // cached across partial prop.post pushes (the device never sends a full
        // snapshot unprompted — see doc/PROTOCOL.md §6).
        this.ephemeralState = {
            work_mode: undefined,
            status: undefined,
            charge_state: undefined,
            fault: undefined,
            quantity: undefined,
            main_brush: undefined,
            side_brush: undefined,
            hypa: undefined,
            mop_life: undefined
        };

        if (this.config.get("embedded") === true) {
            const cert = fs.readFileSync(KaercherRCV5ValetudoRobot.CERT_PATH, "utf8");
            const key = fs.readFileSync(KaercherRCV5ValetudoRobot.KEY_PATH, "utf8");

            this.dummycloud = new KaercherAiotDummycloud({
                tlsContext: new KaercherStaticTLSContext({cert: cert, key: key}),
                bindIP: KaercherAiotDummycloud.BIND_IP,
                onConnected: () => {
                    // Mirrors what the real cloud does per project_rcv5_valetudo_step7_live_confirmed
                    // memory: it doesn't matter whether this re-serves an existing map or
                    // prompts a fresh one, so just always ask for a refresh on connect.
                    this.sendServiceInvoke("upload_by_maptype", {map_type: 0}).catch(e => {
                        Logger.warn("KaercherRCV5ValetudoRobot: failed to request a map refresh", e);
                    });
                },
                onIncomingCloudMessage: (topic, envelope) => {
                    if (envelope?.method === "prop.post" && envelope.params) {
                        this.parseAndUpdateState(envelope.params);
                    }
                },
                onSpecificUseUpload: (dir, body) => {
                    this.handleSpecificUseUpload(dir, body);
                }
            });
        }

        [
            capabilities.KaercherBasicControlCapability,
            capabilities.KaercherFanSpeedControlCapability,
            capabilities.KaercherWaterUsageControlCapability,
            capabilities.KaercherConsumableMonitoringCapability,
            capabilities.KaercherMapSegmentationCapability
        ].forEach(capability => {
            this.registerCapability(new capability({robot: this}));
        });

        this.state.upsertFirstMatchingAttribute(new stateAttrs.StatusStateAttribute({
            value: stateAttrs.StatusStateAttribute.VALUE.IDLE
        }));
    }

    async shutdown() {
        await super.shutdown();

        if (this.dummycloud) {
            await this.dummycloud.shutdown();
        }
    }

    /**
     * @param {string} dir the S3 object path the upload arrived for
     * @param {Buffer} body raw PUT body
     */
    handleSpecificUseUpload(dir, body) {
        // Only the primary `temp/_1` slot is parsed — confirmed live this session to
        // be the one carrying current_pose/history_pose and the newest
        // map_upload_date; `_2` is an older, pose-less snapshot with identical grid
        // data, `_3` was empty. See project_rcv5_valetudo_step7_live_confirmed memory.
        if (!dir.includes("/map/temp/") || !dir.endsWith("_1")) {
            Logger.debug(`KaercherRCV5ValetudoRobot: ignoring upload for dir='${dir}'`);
            return;
        }
        if (!this.dummycloud.sn || !this.dummycloud.mac) {
            Logger.warn("KaercherRCV5ValetudoRobot: received a map upload before sn/mac were known, dropping it");
            return;
        }

        const parser = new KaercherMapParser({
            sn: this.dummycloud.sn,
            mac: this.dummycloud.mac,
            productId: KaercherAiotDummycloud.PRODUCT_ID
        });
        const map = parser.parse(body);

        if (map) {
            this.state.map = map;
            this.emitMapUpdated();
        }
    }

    /**
     * doc/PROTOCOL.md §5: service_invoke commands, topic
     * `service_invoke/{serviceName}`, method `service.{serviceName}`, version "3.0".
     *
     * @param {string} serviceName
     * @param {object} params
     * @return {Promise<void>}
     */
    async sendServiceInvoke(serviceName, params) {
        return this.dummycloud.publishCommand(`service_invoke/${serviceName}`, `service.${serviceName}`, params, "3.0");
    }

    /**
     * doc/PROTOCOL.md §5: fan speed/water/cleaning mode all go through this single
     * topic+method, version "1.0" — confirmed by live capture, distinct from
     * service_invoke's "3.0".
     *
     * @param {object} params e.g. {wind: 2}, {water: 1}, {mode: 0}
     * @return {Promise<void>}
     */
    async sendPropertySet(params) {
        return this.dummycloud.publishCommand("service/property/set", "prop.set", params, "1.0");
    }

    /**
     * @param {object} data flat property object from a prop.post push — may be partial
     */
    parseAndUpdateState(data) {
        if (typeof data !== "object" || data === null) {
            return;
        }

        let statusRelevant = false;
        for (const key of ["work_mode", "status", "charge_state", "fault"]) {
            if (data[key] !== undefined) {
                this.ephemeralState[key] = data[key];
                statusRelevant = true;
            }
        }
        for (const key of ["main_brush", "side_brush", "hypa", "mop_life"]) {
            if (data[key] !== undefined) {
                this.ephemeralState[key] = data[key];
            }
        }

        if (data.quantity !== undefined) {
            this.ephemeralState.quantity = data.quantity;
        }

        // charge_state/fault arrive independently of quantity (partial pushes), but
        // both affect the battery flag — refresh it whenever either changes, as long
        // as a level is already known. Missed this the first time: a docked+charge-
        // finish push with no quantity field left the flag stale at "discharging".
        if ((data.quantity !== undefined || statusRelevant) && this.ephemeralState.quantity !== undefined) {
            this.state.upsertFirstMatchingAttribute(new stateAttrs.BatteryStateAttribute({
                level: this.ephemeralState.quantity,
                flag: this.getBatteryFlag()
            }));
        }

        if (statusRelevant) {
            this.updateStatusAttribute();
        }

        if (data.wind !== undefined) {
            this.state.upsertFirstMatchingAttribute(new stateAttrs.PresetSelectionStateAttribute({
                type: stateAttrs.PresetSelectionStateAttribute.TYPE.FAN_SPEED,
                value: KaercherConst.WIND_TO_PRESET[data.wind] ?? stateAttrs.PresetSelectionStateAttribute.INTENSITY.CUSTOM,
                customValue: KaercherConst.WIND_TO_PRESET[data.wind] === undefined ? data.wind : undefined,
                metaData: {rawValue: data.wind}
            }));
        }

        if (data.water !== undefined) {
            this.state.upsertFirstMatchingAttribute(new stateAttrs.PresetSelectionStateAttribute({
                type: stateAttrs.PresetSelectionStateAttribute.TYPE.WATER_GRADE,
                value: KaercherConst.WATER_TO_PRESET[data.water] ?? stateAttrs.PresetSelectionStateAttribute.INTENSITY.CUSTOM,
                customValue: KaercherConst.WATER_TO_PRESET[data.water] === undefined ? data.water : undefined,
                metaData: {rawValue: data.water}
            }));
        }

        this.emitStateAttributesUpdated();
    }

    /**
     * @protected
     * @return {import("../../entities/state/attributes/BatteryStateAttribute").BatteryStateAttributeFlag}
     */
    getBatteryFlag() {
        return KaercherStateDerivation.deriveBatteryFlag(this.ephemeralState);
    }

    /**
     * @protected
     */
    updateStatusAttribute() {
        const {value, faultCode} = KaercherStateDerivation.deriveStatus(this.ephemeralState);

        this.state.upsertFirstMatchingAttribute(new stateAttrs.StatusStateAttribute({
            value: value,
            error: faultCode !== undefined ? this.buildRobotError(faultCode) : undefined
        }));
    }

    /**
     * @protected
     * @param {number} faultCode
     * @return {ValetudoRobotError}
     */
    buildRobotError(faultCode) {
        return new ValetudoRobotError({
            severity: {
                kind: ValetudoRobotError.SEVERITY_KIND.UNKNOWN,
                level: ValetudoRobotError.SEVERITY_LEVEL.UNKNOWN
            },
            subsystem: ValetudoRobotError.SUBSYSTEM.UNKNOWN,
            message: KaercherConst.FAULT_MESSAGES[faultCode] ?? `Fault ${faultCode}`,
            vendorErrorCode: `${faultCode}`
        });
    }

    getManufacturer() {
        return "Kärcher";
    }

    getModelName() {
        return "RCV 5";
    }

    static IMPLEMENTATION_AUTO_DETECTION_HANDLER() {
        let productMode;

        try {
            productMode = fs.readFileSync("/oem/sysconf/productMode.ini", "utf8");
        } catch (e) {
            Logger.trace("cannot read", "/oem/sysconf/productMode.ini", e);
            return false;
        }

        return productMode.includes("product_mode=Kaercher.KaercherRCV5Es");
    }
}

// Provisional — not yet the final on-device deployment path (that's a later build
// step; these currently match the dev-test harness at
// local/karcher-dev-certs/{server_v1.crt,server.key}).
KaercherRCV5ValetudoRobot.CERT_PATH = "/userdata/karcher-dev-certs/server_v1.crt";
KaercherRCV5ValetudoRobot.KEY_PATH = "/userdata/karcher-dev-certs/server.key";

module.exports = KaercherRCV5ValetudoRobot;
