from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography import x509

with open("server.key", "rb") as f:
    key = serialization.load_pem_private_key(f.read(), password=None)

with open("server.crt", "rb") as f:
    cert = x509.load_pem_x509_certificate(f.read())

der = cert.public_bytes(serialization.Encoding.DER)

def read_len(b, off):
    l = b[off]
    if l < 0x80:
        return l, off + 1
    n = l & 0x7f
    val = int.from_bytes(b[off+1:off+1+n], "big")
    return val, off + 1 + n

# outer SEQUENCE
assert der[0] == 0x30
outer_len, outer_content_off = read_len(der, 1)

# tbsCertificate SEQUENCE
tbs_off = outer_content_off
assert der[tbs_off] == 0x30
tbs_len, tbs_content_off = read_len(der, tbs_off + 1)
tbs_tlv = der[tbs_off: tbs_content_off + tbs_len]
tbs_content = der[tbs_content_off: tbs_content_off + tbs_len]

# version field: context [0] constructed at start of tbs_content
assert tbs_content[0] == 0xA0, hex(tbs_content[0])
ver_len, ver_content_off_rel = read_len(tbs_content, 1)
ver_tlv_len = ver_content_off_rel + ver_len  # bytes consumed by whole version TLV, relative to tbs_content start

new_tbs_content = tbs_content[ver_tlv_len:]

def encode_len(n):
    if n < 0x80:
        return bytes([n])
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(b)]) + b

new_tbs_tlv = b'\x30' + encode_len(len(new_tbs_content)) + new_tbs_content

# sign the new TBS bytes
signature = key.sign(new_tbs_tlv, ec.ECDSA(hashes.SHA256()))

sigalg_tlv = bytes.fromhex("300a06082a8648ce3d040302")  # ecdsa-with-SHA256, no params
sig_bitstring_content = b'\x00' + signature
sig_bitstring_tlv = b'\x03' + encode_len(len(sig_bitstring_content)) + sig_bitstring_content

outer_content = new_tbs_tlv + sigalg_tlv + sig_bitstring_tlv
new_der = b'\x30' + encode_len(len(outer_content)) + outer_content

with open("server_v1.der", "wb") as f:
    f.write(new_der)

import base64
pem = "-----BEGIN CERTIFICATE-----\n"
b64 = base64.b64encode(new_der).decode()
for i in range(0, len(b64), 64):
    pem += b64[i:i+64] + "\n"
pem += "-----END CERTIFICATE-----\n"
with open("server_v1.crt", "w") as f:
    f.write(pem)

print("wrote", len(new_der), "bytes")
