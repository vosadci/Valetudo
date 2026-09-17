const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");

const KaercherMapCrypto = require("../../../../lib/robots/karcher/KaercherMapCrypto");

function loadFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "res", `${name}.json`), "utf-8"));
}

describe("KaercherMapCrypto", () => {
    describe("GET_MAP_ENC_KEY", () => {
        it("matches karcher-home's get_map_enc_key() for a real device fixture", () => {
            const fixture = loadFixture("map_crypto_zlib");

            const key = KaercherMapCrypto.GET_MAP_ENC_KEY(fixture.sn, fixture.mac, fixture.productId);

            assert.strictEqual(key.toString("hex"), fixture.expected_key_hex);
        });
    });

    describe("DECRYPT_MAP", () => {
        it("decrypts a zlib-compressed payload, matching karcher-home's decrypt_map()", () => {
            const fixture = loadFixture("map_crypto_zlib");

            const decrypted = KaercherMapCrypto.DECRYPT_MAP(fixture.sn, fixture.mac, fixture.productId, fixture.blob_b64);

            assert.strictEqual(decrypted.toString("base64"), fixture.expected_plaintext_b64);
        });

        it("falls back to the raw hex-decoded bytes when the payload isn't zlib, matching decrypt_map()'s except branch", () => {
            const fixture = loadFixture("map_crypto_fallback");

            const decrypted = KaercherMapCrypto.DECRYPT_MAP(fixture.sn, fixture.mac, fixture.productId, fixture.blob_b64);

            assert.strictEqual(decrypted.toString("base64"), fixture.expected_plaintext_b64);
        });
    });
});
