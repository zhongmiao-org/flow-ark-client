import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';

// Compile the pinned contract ahead of time: Renderer CSP forbids runtime code generation.
const source = await readFile('contracts/p1.schema.json', 'utf8');
const schema = JSON.parse(source);
const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  inlineRefs: false,
  code: { source: true, esm: true },
});
ajv.addSchema(schema);
const validators = Object.fromEntries(
  schema.$defs.Node.oneOf.map((node, index) => [
    `node_${node.properties.type.const}_${node.properties.version.const}`,
    `${schema.$id}#/$defs/Node/oneOf/${index}`,
  ]),
);
if (Object.keys(validators).length !== schema.$defs.Node.oneOf.length)
  throw new Error('Node variants must have distinct type/version pairs');
for (const name of ['Preview', 'Receipt'])
  validators['handoff_' + name.toLowerCase() + '_v1'] = `${schema.$id}#/$defs/EntryHandoff${name}`;
validators.template_human_review_v1 = `${schema.$id}#/$defs/TemplateHumanReview`;
validators.conversation_snapshot_v1 = `${schema.$id}#/$defs/ConversationSnapshot`;
validators.conversation_event_v1 = `${schema.$id}#/$defs/ConversationEvent`;
validators.conversation_output_v1 = `${schema.$id}#/$defs/ConversationOutput`;
for (const name of ['Source', 'Preview', 'Request', 'Result', 'Status'])
  validators['trial_' + name.toLowerCase() + '_v1'] = `${schema.$id}#/$defs/SkillTrial${name}`;
validators.document_result_v1 = `${schema.$id}#/$defs/DocumentResult`;
validators.ai_outcome_v1 = `${schema.$id}#/$defs/AIOutcome`;
validators.ai_receipt_v1 = `${schema.$id}#/$defs/AINodeReceipt`;
for (const name of [
  'SkillVersionRef',
  'SkillDraft',
  'SkillManifest',
  'SkillVersion',
  'SkillProposalSnapshot',
])
  validators['skill_' + name.replace(/^Skill/, '').toLowerCase() + '_v1'] =
    `${schema.$id}#/$defs/${name}`;
const digest = createHash('sha256').update(source).digest('hex');
for (const name of ['Definition', 'Draft', 'PackageMetadata', 'Checkout', 'ExportReceipt'])
  validators['author_' + name.toLowerCase() + '_v1'] = `${schema.$id}#/$defs/TemplateAuthor${name}`;
for (const name of ['Context', 'State', 'Output', 'WriteReceipt', 'EditResult'])
  validators['data_' + name.toLowerCase() + '_v1'] = `${schema.$id}#/$defs/TemplateData${name}`;
for (const name of ['Context', 'Result'])
  validators['author_sdk_' + name.toLowerCase() + '_v1'] =
    `${schema.$id}#/$defs/TemplateAuthorSdk${name}`;
const banner = `/* Generated from contracts/p1.schema.json (${digest}). Do not edit. */`;
await build({
  stdin: { contents: standaloneCode(ajv, validators), resolveDir: process.cwd(), loader: 'js' },
  outfile: 'src/shared/node-schema.generated.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  banner: { js: banner },
  logLevel: 'error',
});
await writeFile(
  'src/shared/node-schema.generated.d.ts',
  `${banner}\nimport type { ValidateFunction } from 'ajv';\n` +
    Object.keys(validators)
      .map((name) => `export const ${name}: ValidateFunction;`)
      .join('\n') +
    '\n',
);
