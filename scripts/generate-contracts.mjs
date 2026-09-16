import { readFile, writeFile } from 'node:fs/promises';
import { compile } from 'json-schema-to-typescript';
const schema = JSON.parse(await readFile('contracts/p1.schema.json', 'utf8'));
const root = {
  ...schema,
  type: 'object',
  properties: Object.fromEntries(
    Object.keys(schema.$defs)
      .filter((n) => n !== 'Json' && n !== 'Value')
      .map((n) => [n, { $ref: '#/$defs/' + n }]),
  ),
  additionalProperties: false,
};
await writeFile(
  'src/shared/contracts.generated.ts',
  await compile(root, 'P1Contracts', {
    bannerComment: '/* Generated from pinned contracts/p1.schema.json. Do not edit. */',
    style: { singleQuote: true },
    unknownAny: false,
  }),
);
