const crypto = require("crypto");
const zlib = require("zlib");

/**
 * Port of karcher-home's karcher.utils.get_map_enc_key/decrypt_map.
 */
class KaercherMapCrypto {
    /**
     * @param {string} sn
     * @param {string} mac
     * @param {string} productId
     * @return {Buffer}
     */
    static GET_MAP_ENC_KEY(sn, mac, productId) {
        const subKey = mac.replace(/:/g, "").toLowerCase() + productId;
        const subKeyBytes = Buffer.from(subKey.slice(0, 16), "utf-8");

        const plain = Buffer.from(`${sn}+${productId}+${sn}`, "utf-8");
        const cipher = crypto.createCipheriv("aes-128-ecb", subKeyBytes, null);
        const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
        const key = encrypted.toString("base64");

        const hash = crypto.createHash("md5").update(key, "utf-8").digest("hex");
        return Buffer.from(hash.slice(8, 24), "utf-8");
    }

    /**
     * @param {string} sn
     * @param {string} mac
     * @param {string} productId
     * @param {string} data base64-encoded AES-128-ECB ciphertext
     * @return {Buffer} decompressed RobotMap protobuf bytes
     */
    static DECRYPT_MAP(sn, mac, productId, data) {
        const key = KaercherMapCrypto.GET_MAP_ENC_KEY(sn, mac, productId);
        const decipher = crypto.createDecipheriv("aes-128-ecb", key, null);
        decipher.setAutoPadding(false);
        const raw = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]);

        const padLen = raw[raw.length - 1];
        const hex = raw.subarray(0, raw.length - padLen).toString("utf-8");
        const compressed = Buffer.from(hex, "hex");

        try {
            return zlib.inflateSync(compressed);
        } catch {
            return compressed;
        }
    }
}

module.exports = KaercherMapCrypto;
