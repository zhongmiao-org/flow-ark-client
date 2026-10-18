/** Deterministic protocol reference; no vault, Store, network, Schema or UI access. */
import { canonical, bytes, digest } from './entry-result-view.mjs';

const fields = new Set([
  'apikey', 'apisecret', 'authorization', 'proxyauthorization', 'accesstoken',
  'refreshtoken', 'idtoken', 'bearertoken', 'password', 'passwd', 'secret',
  'clientsecret', 'credential', 'credentials', 'cookie', 'setcookie',
  'privatekey', 'signingkey', 'sessiontoken', '密钥', '密码', '凭据',
]);
const patterns = () => [
  /(?:sk[-_]|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g,
  /Bearer[ \t]+[A-Za-z0-9._~+\/-]+=*/gi,
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];
export const credentialField = key => fields.has(key.replace(/[A-Z]/g, c => c.toLowerCase()).replace(/[_.\- \t]/g, ''));
export function credentialPolicy(known) {
  if (!Array.isArray(known) || known.length > 256 || known.some(s =>
    typeof s !== 'string' || !s.length || Buffer.byteLength(s, 'utf8') > 16384) ||
    known.reduce((n, s) => n + Buffer.byteLength(s, 'utf8'), 0) > 65536)
    throw Error('credential-set-limit');
  const secrets = [...new Set(known)].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  function text(input) {
    if (typeof input !== 'string') throw Error('not-text');
    let value = input;
    for (let round = 0; round < 64; round++) {
      let next = value;
      for (const secret of secrets) next = next.split(secret).join('');
      for (const pattern of patterns()) next = next.replace(pattern, '');
      if (next === value) return value;
      value = next;
    }
    // No partial value is delivered if the fixed point needs a larger budget.
    throw Error('credential-filter-limit');
  }
  function value(input) {
    if (bytes(input) > 196608) throw Error('value-limit');
    const walk = v => {
      if (typeof v === 'string') return text(v);
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        const out = {};
        for (const key of Object.keys(v)) {
          // Never rename a secret key: no collisions, guessed identity or anonymous keys.
          if (text(key) !== key) throw Error('credential-in-key');
          Object.defineProperty(out, key, {
            value: credentialField(key) ? '' : walk(v[key]),
            enumerable: true, configurable: true, writable: true,
          });
        }
        return out;
      }
      return v;
    };
    const filtered = walk(input);
    if (bytes(filtered) > 196608) throw Error('value-limit');
    return { value: filtered, dataChanged: canonical(input) !== canonical(filtered),
      dataSha256: digest(filtered), dataBytes: bytes(filtered) };
  }
  return { text, value };
}
