/** Read-only draft shape/relationship check. No application runtime or user data. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { verifyReference, verifyRead, verifyResponse, verifyProof, verifyCursor,
  verifyLease, verifyPrepared, assertDeclaration, canonical, digest, bytes } from './run-result-binding.mjs';
import { credentialPolicy } from './run-result-credentials.mjs';

if (!process.argv[2]) throw Error('Provide a dependency directory containing ajv/dist/2020.js');
const require = createRequire(resolve(process.argv[2], 'package.json'));
const Ajv = require('ajv/dist/2020.js').default;
const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const wire = read('run-result-binding.schema.json');
const ajv = new Ajv({ strict: true, allErrors: true });
const validate = ajv.compile(wire);
let mainAjv, main;
if (process.argv[3]) {
  main = JSON.parse(readFileSync(process.argv[3], 'utf8'));
  mainAjv = new Ajv({ strict: false, allErrors: true });
  mainAjv.addSchema(main);
  const rename = v => Array.isArray(v) ? v.map(rename) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k,
      k === '$ref' && x.startsWith('#/$defs/') ? '#/$defs/RunResult' + x.slice(8) : rename(x)])) : v;
  for (const [key, def] of Object.entries(wire.$defs))
    if (canonical(main.$defs['RunResult' + key]) !== canonical(rename(def))) throw Error('main definition mismatch: ' + key);
}
const counts = { valid: 0, 'format-invalid': 0, 'relation-invalid': 0 };
for (const item of read('run-result-binding.cases.json')) {
  if (bytes(item.value) > 524288) throw Error('fixture wire budget');
  const shape = validate(item.value);
  if (mainAjv && mainAjv.getSchema(main.$id + '#/$defs/RunResultWire')(item.value) !== shape)
    throw Error(item.id + ': main wire mismatch');
  if (item.expected === 'format-invalid') {
    if (shape) throw Error(item.id + ': expected format rejection');
  } else {
    if (!shape) throw Error(item.id + ': ' + JSON.stringify(validate.errors));
    let relation = true;
    try {
      if (item.owner) {
        if ('value' in item.value) verifyRead(item.value, item.owner, item.resource);
        else verifyReference(item.value, item.owner, item.resource);
      }
    } catch { relation = false; }
    if (relation !== (item.expected === 'valid')) throw Error(item.id + ': relationship mismatch');
  }
  if (!(item.expected in counts)) throw Error('unknown classification');
  counts[item.expected]++;
}
console.log(JSON.stringify({ scope: 'draft pure format and relationships only', counts }));

const semantic = { valid: 0, 'format-invalid': 0, 'relation-invalid': 0 };
for (const item of read('run-result-binding.semantic.json')) {
  if (bytes(item.value) > 524288) throw Error('fixture wire budget');
  const check = ajv.getSchema(wire.$id + '#/$defs/' + item.schema);
  if (!check) throw Error('unknown fixture schema');
  const shape = check(item.value);
  if (mainAjv && mainAjv.getSchema(main.$id + '#/$defs/RunResult' + item.schema)(item.value) !== shape)
    throw Error(item.id + ': main shape mismatch');
  let relation = true;
  if (shape) try {
    const r = item.relation;
    if (r?.kind === 'response') verifyResponse(item.value, r.request, r.owner, r.resource);
    if (r?.kind === 'proof') verifyProof(item.value, r.owner, r.resource);
    if (r?.kind === 'lease') verifyLease(item.value, r.now, r.expected);
    if (r?.kind === 'cursor') verifyCursor(item.value, r.expected);
    if (r?.kind === 'prepared') verifyPrepared(item.value, r.consumerRunId);
    if (r?.kind === 'declaration') assertDeclaration(item.value);
  } catch { relation = false; }
  if (item.expected === 'format-invalid' ? shape : !shape || relation !== (item.expected === 'valid'))
    throw Error(item.id + ': semantic fixture mismatch ' + JSON.stringify(check.errors));
  semantic[item.expected]++;
}
console.log(JSON.stringify({ scope: 'wire and private lifecycle relationships only', counts: semantic }));

const policy = { valid: 0, invalid: 0 };
for (const item of read('run-result-credentials.cases.json')) {
  const input = item.recipe ? item.recipe.character.repeat(item.recipe.count) : item.value;
  const k = item.knownRecipe;
  const known = k ? Array(k.items).fill(k.character.repeat(k.count)) : item.known;
  let actual, failure;
  try {
    if (bytes(input) > 196608) throw Error('value-limit');
    const schema = item.schema && new Ajv({ strict: true }).compile(item.schema);
    if (schema && !schema(input)) throw Error('original-schema-invalid');
    actual = credentialPolicy(known).value(input);
    if (schema && !schema(actual.value)) throw Error('filtered-schema-invalid');
  } catch (e) { failure = e.message; }
  if (item.expected === 'valid') {
    if (failure || canonical(actual.value) !== canonical(item.recipe ? input : item.filtered) ||
        actual.dataSha256 !== digest(actual.value) || actual.dataBytes !== bytes(actual.value) ||
        actual.dataChanged !== (canonical(input) !== canonical(actual.value))) throw Error(item.id + ': policy mismatch ' + failure);
  } else if (!failure || (item.reason && item.reason !== failure)) throw Error(item.id + ': expected policy rejection ' + failure);
  policy[item.expected]++;
}
console.log(JSON.stringify({ scope: 'synthetic credential transformation and double Schema only', counts: policy }));
if (main) console.log(JSON.stringify({ embeddedDefinitionsExact: Object.keys(wire.$defs).length }));
