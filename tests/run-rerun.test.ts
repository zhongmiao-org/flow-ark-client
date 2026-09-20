import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateIPC } from '../src/shared/ipc';
import { runRerunConfirmSchema, runRerunPreviewSchema } from '../src/shared/run-rerun';
import { assertRerunBindings } from '../src/host/run-rerun';
import { defaultPolicy } from '../src/recruiting/policy';
import { normalizeBindings } from '../src/host/configuration';
import type { Bindings } from '../src/shared/types';

const selection = { id: 'original-run', mode: 'snapshot' as const };
const confirmation = () => ({
  ...selection,
  token: 'a'.repeat(64),
  requestId: randomUUID(),
  reviewed: true as const,
});

test('rerun IPC accepts explicit snapshot or saved selection and an optional debug switch', () => {
  for (const mode of ['snapshot', 'saved'] as const) {
    for (const debug of [undefined, false, true]) {
      const args = { ...selection, mode, ...(debug === undefined ? {} : { debug }) };
      assert.deepEqual(validateIPC('run.rerun.preview', args), args);
      const confirmed = { ...confirmation(), ...args };
      assert.deepEqual(validateIPC('run.rerun.confirm', confirmed), confirmed);
    }
  }
  assert.doesNotThrow(() =>
    validateIPC('run.rerun.preview', { ...selection, id: 'x'.repeat(100) }),
  );
});

test('rerun preview rejects unknown fields, invalid IDs, implicit sources and nonboolean debugging', () => {
  for (const change of [
    { id: '' },
    { id: 'x'.repeat(101) },
    { id: 7 },
    { mode: undefined },
    { mode: 'current' },
    { mode: null },
    { debug: 'true' },
    { debug: 0 },
    { flow: {} },
    { bindings: { credentials: ['other'] } },
    { versionId: 'unreviewed-version' },
    { reviewed: true },
  ]) {
    const args = { ...selection, ...change };
    assert.throws(() => validateIPC('run.rerun.preview', args));
    assert.throws(() => runRerunPreviewSchema.parse(args));
  }
});

test('rerun confirmation requires an exact review, digest and UUID and cannot carry execution overrides', () => {
  for (const change of [
    { reviewed: undefined },
    { reviewed: false },
    { reviewed: 'true' },
    { token: undefined },
    { token: 'A'.repeat(64) },
    { token: 'g'.repeat(64) },
    { token: 'a'.repeat(63) },
    { token: 'a'.repeat(65) },
    { requestId: undefined },
    { requestId: '' },
    { requestId: 'same-request' },
    { requestId: 'f'.repeat(64) },
    { id: '' },
    { mode: 'resume' },
    { debug: 'false' },
    { parameters: { alter: true } },
    { bindings: {} },
    { resumeFrom: 'second-step' },
    { source: 'schedule' },
  ]) {
    const args = { ...confirmation(), ...change };
    assert.throws(() => validateIPC('run.rerun.confirm', args));
    assert.throws(() => runRerunConfirmSchema.parse(args));
  }
  assert.throws(
    () =>
      validateIPC('run.rerun.confirm', { ...confirmation(), extra: 'x'.repeat(2 * 1024 * 1024) }),
    /2 MiB/,
  );
});

test('rerun authority permits changed parameter values but rejects changed form definitions and private policy', () => {
  const original: Bindings = {
    files: {},
    credentials: [],
    configuration: {
      adapter: 'flow-parameters-v1',
      schema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      values: { value: 'original' },
    },
  };
  const updated = structuredClone(original);
  updated.configuration!.values = { value: 'current' };
  assert.doesNotThrow(() => assertRerunBindings(original, updated));
  const changedSchema = structuredClone(updated);
  (changedSchema.configuration!.schema as any).title = 'Another form definition';
  assert.throws(() => assertRerunBindings(original, changedSchema));
  assert.throws(() => assertRerunBindings(original, { files: {}, credentials: [] }));
  const invalidValues = structuredClone(updated);
  invalidValues.configuration!.values = { value: false };
  assert.throws(() => assertRerunBindings(original, invalidValues));

  const legacy: Bindings = { files: {}, credentials: [], policy: defaultPolicy('boss') };
  const normalized = normalizeBindings(structuredClone(legacy));
  assert.doesNotThrow(() => assertRerunBindings(legacy, normalized));
  const revised = structuredClone(normalized);
  (revised.configuration!.values as any).actions.reply = 'deny';
  assert.throws(() => assertRerunBindings(legacy, revised));
});

test('binding authorization is a subset check while paths, browser identities and package versions remain exact', () => {
  const original: Bindings = {
    files: { work: '/fictional/work' },
    credentials: ['fixture'],
    browserId: 'embedded',
    scriptPackages: { library: { path: '/fictional/package', version: '1.0.0' } },
  };
  const additional: Bindings = {
    ...structuredClone(original),
    files: { ...original.files, other: '/fictional/other' },
    credentials: ['other', 'fixture'],
    scriptPackages: {
      ...original.scriptPackages,
      another: { path: '/fictional/another', version: '2.0.0' },
    },
  };
  assert.doesNotThrow(() => assertRerunBindings(original, additional));
  const invalid: Bindings[] = [
    { ...original, files: {} },
    { ...original, files: { work: '/fictional/other' } },
    { ...original, credentials: [] },
    { ...original, browserId: undefined },
    { ...original, browserId: 'different' },
    { ...original, scriptPackages: {} },
    { ...original, scriptPackages: { library: { path: '/fictional/package', version: '2.0.0' } } },
  ];
  for (const candidate of invalid) assert.throws(() => assertRerunBindings(original, candidate));
});
