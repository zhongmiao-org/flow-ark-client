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
const groups = new Map();
schema.$defs.Node.oneOf.forEach((node, index) => {
  const key = `node_${node.properties.type.const.replaceAll('-', '_')}_${node.properties.version.const}`;
  groups.set(key, [...(groups.get(key) ?? []), { node, index }]);
});
const validators = {};
for (const [key, variants] of groups) {
  const refs = variants.map(({ index }) => ({ $ref: `${schema.$id}#/$defs/Node/oneOf/${index}` }));
  if (variants.length === 1) validators[key] = refs[0].$ref;
  else {
    if (
      key !== 'node_source_1' ||
      variants.some(({ node }) => !node.properties.operation?.const) ||
      new Set(variants.map(({ node }) => node.properties.operation.const)).size !== variants.length
    )
      throw new Error('Node variants must have distinct type/version or source operation');
    const id = schema.$id + '.source-node-v1';
    ajv.addSchema({ $id: id, oneOf: refs });
    validators[key] = id;
  }
}
for (const name of ['Preview', 'Receipt'])
  validators['handoff_' + name.toLowerCase() + '_v1'] = `${schema.$id}#/$defs/EntryHandoff${name}`;
validators.template_human_review_v1 = `${schema.$id}#/$defs/TemplateHumanReview`;
validators.conversation_snapshot_v1 = `${schema.$id}#/$defs/ConversationSnapshot`;
validators.conversation_event_v1 = `${schema.$id}#/$defs/ConversationEvent`;
validators.conversation_output_v1 = `${schema.$id}#/$defs/ConversationOutput`;
for (const name of [
  'Context',
  'ThreadSnapshot',
  'ThreadEvent',
  'HistoryPage',
  'ThreadPrepared',
  'ThreadEntry',
  'Checkpoint',
  'CheckpointEvidence',
  'ThreadOutput',
  'ContextProposal',
])
  validators['conversation_' + name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() + '_v2'] =
    `${schema.$id}#/$defs/Conversation${name}`;
for (const name of ['Source', 'Preview', 'Request', 'Result', 'Status'])
  validators['trial_' + name.toLowerCase() + '_v1'] = `${schema.$id}#/$defs/SkillTrial${name}`;
for (const name of ['Capture', 'Ref', 'Record', 'Manifest', 'Cursor', 'Page'])
  validators['archive_' + name.toLowerCase() + '_v1'] =
    `${schema.$id}#/$defs/ConversationArchive${name}`;
for (const name of ['Cursor', 'Chunk', 'Read', 'ManifestOutput'])
  validators['source_' + name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() + '_v1'] =
    `${schema.$id}#/$defs/ConversationSource${name}`;
for (const name of [
  'Recipe',
  'Ref',
  'Checkpoint',
  'Transport',
  'Attempt',
  'Proof',
  'Evidence',
  'Output',
])
  validators['reduction_' + name.toLowerCase() + '_v1'] =
    `${schema.$id}#/$defs/SourceReduction${name}`;
for (const name of ['RunReview', 'RunConfirmation', 'RunReviewReceipt'])
  validators['reduction_' + name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() + '_v1'] =
    `${schema.$id}#/$defs/SourceReduction${name}`;
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
for (const name of [
  'Info',
  'Review',
  'Selection',
  'Apply',
  'Receipt',
  'ProposalOutput',
  'Application',
  'Detail',
])
  validators['skill_update_' + name.toLowerCase() + '_v1'] =
    `${schema.$id}#/$defs/SkillUpdate${name}`;
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
