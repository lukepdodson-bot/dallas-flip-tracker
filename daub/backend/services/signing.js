/**
 * Ed25519 signing for registry entries and licence countersignatures.
 *
 * The key lives in REGISTRY_PRIVATE_KEY in production. In development it is
 * generated once into the data directory, so certificates issued locally stay
 * verifiable across restarts. If the key ever changes, previously issued
 * certificates still verify against the published historical key id - which is
 * why key_id is stored on every entry rather than assumed.
 */
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

let cached = null;

function load() {
  if (cached) return cached;

  let privatePem = process.env.REGISTRY_PRIVATE_KEY;

  if (!privatePem) {
    const { DATA_DIR } = require('../db/database');
    const keyPath = path.join(DATA_DIR, 'registry-key.pem');
    if (fs.existsSync(keyPath)) {
      privatePem = fs.readFileSync(keyPath, 'utf8');
    } else {
      const { privateKey } = crypto.generateKeyPairSync('ed25519');
      privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      fs.writeFileSync(keyPath, privatePem, { mode: 0o600 });
      console.log(`[registry] Generated a signing key at ${keyPath}. ` +
                  'Set REGISTRY_PRIVATE_KEY in production so it survives redeploys.');
    }
  }

  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey  = crypto.createPublicKey(privateKey);
  const publicPem  = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const publicDer  = publicKey.export({ type: 'spki', format: 'der' });
  const keyId      = crypto.createHash('sha256').update(publicDer).digest('hex').slice(0, 16);

  cached = { privateKey, publicKey, publicPem, keyId };
  return cached;
}

/** Sign a hex digest. Returns base64. */
function sign(contentHash) {
  const { privateKey } = load();
  return crypto.sign(null, Buffer.from(contentHash, 'utf8'), privateKey).toString('base64');
}

/** Verify a signature against a hex digest, optionally under a specific public key. */
function verify(contentHash, signatureB64, publicPem) {
  try {
    const key = publicPem ? crypto.createPublicKey(publicPem) : load().publicKey;
    return crypto.verify(null, Buffer.from(contentHash, 'utf8'), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

const publicKeyPem = () => load().publicPem;
const keyId        = () => load().keyId;

module.exports = { sign, verify, publicKeyPem, keyId };
