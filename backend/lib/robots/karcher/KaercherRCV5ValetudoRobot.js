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

        const knownIdentity = this.readKnownIdentity();

        if (this.config.get("embedded") === true) {
            const cert = fs.readFileSync(KaercherRCV5ValetudoRobot.CERT_PATH, "utf8");
            const key = fs.readFileSync(KaercherRCV5ValetudoRobot.KEY_PATH, "utf8");

            this.dummycloud = new KaercherAiotDummycloud({
                tlsContext: new KaercherStaticTLSContext({cert: cert, key: key}),
                bindIP: KaercherRCV5ValetudoRobot.BIND_IP,
                knownSn: knownIdentity.sn,
                knownMac: knownIdentity.mac,
                onConnected: () => {
                    // Mirrors what the real cloud does per project_rcv5_valetudo_step7_live_confirmed
                    // memory: it doesn't matter whether this re-serves an existing map or
                    // prompts a fresh one, so just always ask for a refresh on connect.
                    this.sendServiceInvoke("upload_by_maptype", {map_type: 0}).catch(e => {
                        Logger.warn("KaercherRCV5ValetudoRobot: failed to request a map refresh", e);
                    });
                    // Without this, state only ever reflects whatever the robot happens to
                    // push unprompted — confirmed live 2026-09-18 that fields like `water`
                    // can go an entire session without ever being pushed, leaving
                    // WaterUsageControlCapability's WebUI widget stuck on "Error loading"
                    // (no PresetSelectionStateAttribute had ever been set). The real app
                    // does exactly this request on every connect (karcher-home's
                    // request_device_update()) — mirrored here for the same reason.
                    this.sendPropertyGet().catch(e => {
                        Logger.warn("KaercherRCV5ValetudoRobot: failed to request a full property snapshot", e);
                    });
                },
                onIncomingCloudMessage: (topic, envelope) => {
                    if (envelope?.method === "prop.post" && envelope.params) {
                        this.parseAndUpdateState(envelope.params);
                    } else if (topic.endsWith("/service/property/get_reply") && envelope?.code === 0 && envelope.data) {
                        // Reply to sendPropertyGet() — a different envelope shape entirely
                        // ({code, data}, not {method, params}), confirmed against
                        // karcher-home's own _process_mqtt_message()/_update_device_properties(),
                        // which dispatches purely by topic rather than by any method field.
                        this.parseAndUpdateState(envelope.data);
                    }
                },
                onSpecificUseUpload: (dir, body) => {
                    this.handleSpecificUseUpload(dir, body);
                },
                onIdentityLearned: (sn, mac) => {
                    this.persistIdentity(sn, mac);
                }
            });
        }

        // Static across restarts, same reasoning as sn/mac persistence above: the
        // Suction Station RCV 5 is a physically-attached accessory, sold separately
        // (project_auto_empty_dock memory), so whether it's present doesn't change
        // within a boot session. Deciding this HERE, synchronously from the last
        // persisted value, is required, not just convenient — WebServer's
        // CapabilitiesRouter and MQTT's RobotMqttHandle both build their route/handle
        // trees once from `this.capabilities` at their own startup (confirmed by
        // reading both), so registering the capability later from a live
        // charge_station_type push would silently 404 on every actual action
        // endpoint despite appearing to exist.
        this.knownHasAutoEmptyDock = knownIdentity.hasAutoEmptyDock;

        /** @type {Array<new (options: {robot: KaercherRCV5ValetudoRobot}) => import("../../core/capabilities/Capability")>} */
        const capabilitiesToRegister = [
            capabilities.KaercherBasicControlCapability,
            capabilities.KaercherFanSpeedControlCapability,
            capabilities.KaercherWaterUsageControlCapability,
            capabilities.KaercherOperationModeControlCapability,
            capabilities.KaercherConsumableMonitoringCapability,
            capabilities.KaercherMapSegmentationCapability
        ];

        if (this.knownHasAutoEmptyDock === true) {
            capabilitiesToRegister.push(capabilities.KaercherAutoEmptyDockManualTriggerCapability);
        }

        capabilitiesToRegister.forEach(capability => {
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
     * sn/mac are static per physical device — persisting them once means every
     * later restart already knows both, regardless of whether the robot's
     * aiot_client redoes a full HTTP login or just reconnects MQTT with a cached
     * session (confirmed live 2026-09-18 that it doesn't always redo the login).
     * Without this, mac specifically has no other recovery path at all (unlike
     * sn, it isn't derivable from MQTT traffic), so map decryption would keep
     * silently failing until the next real login happened to occur.
     *
     * @protected
     * @return {{sn?: string, mac?: string, hasAutoEmptyDock?: boolean}}
     */
    readKnownIdentity() {
        try {
            return JSON.parse(fs.readFileSync(KaercherRCV5ValetudoRobot.IDENTITY_PATH, "utf8"));
        } catch (e) {
            Logger.info("KaercherRCV5ValetudoRobot: no persisted device identity yet", e.message);
            return {};
        }
    }

    /**
     * @protected
     * @param {string} sn
     * @param {string} mac
     */
    persistIdentity(sn, mac) {
        this.persistDeviceState({sn: sn, mac: mac});
    }

    /**
     * @protected
     * @param {boolean} present
     */
    persistStationPresence(present) {
        this.persistDeviceState({hasAutoEmptyDock: present});
    }

    /**
     * Merges into the persisted file rather than overwriting it outright — sn/mac
     * and hasAutoEmptyDock are learned independently, at different times, and
     * neither should wipe the other out.
     *
     * @protected
     * @param {object} patch
     */
    persistDeviceState(patch) {
        try {
            const current = this.readKnownIdentity();

            fs.writeFileSync(
                KaercherRCV5ValetudoRobot.IDENTITY_PATH,
                JSON.stringify(Object.assign({}, current, patch))
            );
        } catch (e) {
            Logger.warn("KaercherRCV5ValetudoRobot: failed to persist device state", e);
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
     * Requests a full property snapshot. Ported verbatim from the installed
     * `karcher-home` package's `request_device_update()`: topic
     * `service/property/get`, method `prop.get`, version "3.0" (distinct from
     * prop.set's "1.0"), params `{property: [...]}`. The robot replies on
     * `service/property/get_reply` with a `{code, data}` envelope — handled
     * separately in the constructor's onIncomingCloudMessage, not the {method,
     * params} shape prop.post/service_invoke_reply use.
     *
     * @return {Promise<void>}
     */
    async sendPropertyGet() {
        return this.dummycloud.publishCommand("service/property/get", "prop.get", {property: KaercherConst.ROBOT_PROPERTIES}, "3.0");
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

        if (data.mode !== undefined) {
            this.state.upsertFirstMatchingAttribute(new stateAttrs.PresetSelectionStateAttribute({
                type: stateAttrs.PresetSelectionStateAttribute.TYPE.OPERATION_MODE,
                value: KaercherConst.MODE_TO_PRESET[data.mode] ?? stateAttrs.PresetSelectionStateAttribute.INTENSITY.CUSTOM,
                customValue: KaercherConst.MODE_TO_PRESET[data.mode] === undefined ? data.mode : undefined,
                metaData: {rawValue: data.mode}
            }));
        }

        if (data.charge_station_type !== undefined) {
            const hasStation = data.charge_station_type !== 0;

            if (this.knownHasAutoEmptyDock !== hasStation) {
                this.knownHasAutoEmptyDock = hasStation;
                this.persistStationPresence(hasStation);
            }
        }

        if (data.dust_action !== undefined) {
            // Suction Station RCV 5: dust_action cycles 0 (idle) -> 2 (emptying) -> 0
            // over ~20s (device-confirmed, karcher-rcv5-ha's project_auto_empty_dock
            // memory). `1` has never been observed. station_act is deliberately NOT
            // used here — it stays 0 throughout a real empty cycle on this hardware.
            this.state.upsertFirstMatchingAttribute(new stateAttrs.DockStatusStateAttribute({
                value: data.dust_action === 2 ?
                    stateAttrs.DockStatusStateAttribute.VALUE.EMPTYING :
                    stateAttrs.DockStatusStateAttribute.VALUE.IDLE,
                metaData: {rawValue: data.dust_action}
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

// On-device deployment path — everything Valetudo-owned lives under one directory
// (binary, config, log, certs, identity file), consolidated 2026-09-18. The dev-test
// harness at local/karcher-dev-certs/{server_v1.crt,server.key} is the source these
// get copied from, not where they run from on the robot.
KaercherRCV5ValetudoRobot.CERT_PATH = "/userdata/valetudo/server_v1.crt";
KaercherRCV5ValetudoRobot.KEY_PATH = "/userdata/valetudo/server.key";
// Persisted sn/mac/hasAutoEmptyDock, learned once and reused on every later restart —
// see readKnownIdentity()/persistDeviceState() above for why this exists.
KaercherRCV5ValetudoRobot.IDENTITY_PATH = "/userdata/valetudo/device-identity.json";
// Defaults to the real on-device loopback-alias bind (see KaercherAiotDummycloud.BIND_IP's
// own comment) — only correct once Valetudo actually runs ON the robot. Dev-Mac test
// harnesses running Valetudo remotely need to override this to "0.0.0.0" instead, the
// same way local/karcher-dev-certs/run_dummycloud.js already does for
// KaercherAiotDummycloud directly.
KaercherRCV5ValetudoRobot.BIND_IP = KaercherAiotDummycloud.BIND_IP;

module.exports = KaercherRCV5ValetudoRobot;
