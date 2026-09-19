import datetime
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

key = ec.generate_private_key(ec.SECP256R1())

name = x509.Name([
    x509.NameAttribute(NameOID.COUNTRY_NAME, "CN"),
    x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "GD"),
    x509.NameAttribute(NameOID.LOCALITY_NAME, "SZ"),
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "3irobotix"),
    x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, "IOT"),
    x509.NameAttribute(NameOID.COMMON_NAME, "*.3irobotix.net"),
    x509.NameAttribute(NameOID.EMAIL_ADDRESS, "aiot_faq@3irobotics.com"),
])

builder = (
    x509.CertificateBuilder()
    .subject_name(name)
    .issuer_name(name)
    .public_key(key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
    .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
)
# no extensions added at all -> cryptography still emits v3, make_v1.py strips the
# version field afterward to produce the genuine v1 cert aiot_client's mbedTLS requires.

cert = builder.sign(key, hashes.SHA256())

with open("server.key", "wb") as f:
    f.write(key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    ))

with open("server.crt", "wb") as f:
    f.write(cert.public_bytes(serialization.Encoding.PEM))

print("version:", cert.version)
print("extensions count:", len(cert.extensions))
