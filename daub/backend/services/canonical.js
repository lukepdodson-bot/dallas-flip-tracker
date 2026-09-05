/**
 * Canonical JSON: object keys sorted depth-first, no insignificant whitespace.
 *
 * Certificates are only checkable by a third party if the bytes that were signed
 * can be reproduced exactly from the data. JSON.stringify preserves insertion
 * order, so two servers building the same entry could disagree; this does not.
 */
const crypto = require('crypto');

function canonicalise(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;

  switch (typeof value) {
    case 'number':
      if (!Number.isFinite(value)) throw new Error('Cannot canonicalise a non-finite number');
      return JSON.stringify(value);
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
      throw new Error('Cannot canonicalise undefined - use null for absent values');
    case 'object': {
      const keys = Object.keys(value).sort();
      const parts = keys
        .filter(k => value[k] !== undefined)
        .map(k => `${JSON.stringify(k)}:${canonicalise(value[k])}`);
      return `{${parts.join(',')}}`;
    }
    default:
      throw new Error(`Cannot canonicalise a ${typeof value}`);
  }
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Canonical form plus its digest - the pair every signed record stores. */
function hashOf(value) {
  const canonical = canonicalise(value);
  return { canonical, hash: sha256(canonical) };
}

module.exports = { canonicalise, sha256, hashOf };
