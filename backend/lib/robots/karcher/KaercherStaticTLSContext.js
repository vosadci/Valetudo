/**
 * Static counterpart to DummyCloudTLSManager. The RCV5's aiot_client only trusts a
 * genuine v1 (no-extensions) self-signed cert as its server.crt trust anchor, so unlike
 * Midea's per-SNI dynamically-generated leaf certs, this loads one fixed cert/key pair
 * and serves it for every hostname (one wildcard CN=*.3irobotix.net cert covers both
 * hostnames the robot needs). Deliberately not exposed via SNICallback: observed
 * locally on Node 26 (build target is node22, not yet re-checked there) that
 * https.createServer/tls.createServer with SNICallback and no top-level cert fails
 * cipher negotiation entirely (verified with both this cert and a plain openssl-issued
 * one, so it's a Node/OpenSSL interaction, not specific to the v1 cert format). Since
 * every hostname gets the same context anyway, there's no reason to route through
 * SNICallback at all — pass these options directly to createServer instead.
 */
class KaercherStaticTLSContext {
    /**
     * @param {object} options
     * @param {string} options.cert PEM-encoded v1 certificate
     * @param {string} options.key PEM-encoded private key matching options.cert
     */
    constructor(options) {
        this.cert = options.cert;
        this.key = options.key;
    }

    /**
     * @return {{cert: string, key: string}} suitable for spreading into
     * https.createServer/tls.createServer options
     */
    getTLSOptions() {
        return {
            cert: this.cert,
            key: this.key
        };
    }
}

module.exports = KaercherStaticTLSContext;
