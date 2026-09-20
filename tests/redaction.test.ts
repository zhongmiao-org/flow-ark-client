import test from 'node:test';
import assert from 'node:assert/strict';
import { errorText, redact, redactedErrorText } from '../src/shared/utils';

test('registered secrets in nested object keys and values do not survive log or output redaction', () => {
  const secret = 'fixtureAlpha789';
  const input = {
    rows: [{ [secret]: false }, { ['lookup:' + secret]: 0 }],
    nil: null,
    empty: '',
    nested: { ordinary: secret },
  };
  const original = structuredClone(input);
  const result = redact(input, [secret]);
  assert.deepEqual(result, {
    rows: [{ '[REDACTED_KEY_1]': false }, { '[REDACTED_KEY_1]': 0 }],
    nil: null,
    empty: '',
    nested: { ordinary: '[REDACTED]' },
  });
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(input, original);
  // Store.event and run.detail apply the policy again; neither pass may rename
  // safe output or depend on retaining the original secret key.
  assert.deepEqual(redact(result, [secret]), result);
  assert.deepEqual(redact(result), result);
});

test('multiple hidden keys preserve each value and cannot overwrite later unchanged placeholders', () => {
  const input = {
    'sk-fictional-first': false,
    '[REDACTED_KEY_1]': 'original first',
    'sk-fictional-second': 0,
    '[REDACTED_KEY_2]': null,
    safe: '',
  };
  const result = redact(input);
  assert.deepEqual(result, {
    '[REDACTED_KEY_3]': false,
    '[REDACTED_KEY_1]': 'original first',
    '[REDACTED_KEY_4]': 0,
    '[REDACTED_KEY_2]': null,
    safe: '',
  });
  assert.equal(Object.keys(result).length, Object.keys(input).length);
  assert.ok(!JSON.stringify(result).includes('sk-fictional'));
  assert.deepEqual(redact(result), result);
});

test('anonymous fallback avoids marker-overlapping credentials and existing private-use keys', () => {
  const secrets = ['REDACTED_KEY', '\ue000fixtureAlpha'];
  const input = {
    '[REDACTED_KEY_1]': 'original readable placeholder',
    'lookup:REDACTED_KEY': false,
    '\ue002': 'original anonymous-looking key',
    [secrets[1]]: 0,
  };
  const original = structuredClone(input);
  const result = redact(input, secrets);
  assert.deepEqual(result, {
    '\ue002\ue001': 'original readable placeholder',
    '\ue002\ue002': false,
    '\ue002': 'original anonymous-looking key',
    '\ue002\ue001\ue001': 0,
  });
  assert.equal(Object.keys(result).length, Object.keys(input).length);
  for (const secret of secrets) assert.ok(!JSON.stringify(result).includes(secret));
  assert.deepEqual(input, original);
  assert.deepEqual(redact(result, secrets), result);
  assert.deepEqual(redact(JSON.parse(JSON.stringify(result))), result);
});

test('existing textual privacy patterns hide keys without a credential lookup', () => {
  const result = redact({
    'Bearer fictional_access': 'authorization row label',
    'key sk-fictional-value suffix': 'API entry',
    'phone 13800000000': 'phone entry',
    readable: 'unchanged',
  });
  assert.deepEqual(result, {
    '[REDACTED_KEY_1]': 'authorization row label',
    '[REDACTED_KEY_2]': 'API entry',
    '[REDACTED_KEY_3]': 'phone entry',
    readable: 'unchanged',
  });
  assert.deepEqual(redact(result), result);
});

test('sensitive field names still hide their values even when the names contain no secret', () => {
  assert.deepEqual(
    redact({ password: false, apiKey: 0, body: null, conversation: '', ordinary: false }),
    {
      password: '[REDACTED]',
      apiKey: '[REDACTED]',
      body: '[REDACTED]',
      conversation: '[REDACTED]',
      ordinary: false,
    },
  );
  assert.deepEqual(redact({ 'token:fixtureAlpha789': 'must be hidden' }, ['fixtureAlpha789']), {
    '[REDACTED_KEY_1]': '[REDACTED]',
  });
});

test('safe keys keep their identity including long keys and own prototype-like properties', () => {
  const longKey = 'normal_'.repeat(700);
  const input = JSON.parse('{"__proto__":{"ordinary":false},"constructor":0,"prototype":null}');
  input[longKey] = '';
  const result = redact(input, ['']);
  assert.deepEqual(result, input);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.hasOwn(result, '__proto__'), true);
  assert.equal(result[longKey], '');
});

test('scalar redaction retains masking and bounded preview behavior', () => {
  assert.equal(
    redact('Bearer fictional_access / sk-fictional-api / 13800000000'),
    'Bearer [REDACTED] / [REDACTED] / [PHONE]',
  );
  assert.equal(
    redact('prefix fixtureAlpha789 suffix', ['fixtureAlpha789']),
    'prefix [REDACTED] suffix',
  );
  assert.equal(redact('x'.repeat(4500)).length, 4000);
  for (const value of [false, 0, null, '', true, 42]) assert.equal(redact(value), value);
});

test('public error text masks message values without changing the original error or its classification', () => {
  const secret = 'fixtureAlpha789';
  const error = new Error('preflight ' + secret + ' / sk-fictional-c10 / 13800000000', {
    cause: new Error('private cause ' + secret),
  });
  const message = error.message;
  const cause = error.cause;
  assert.equal(redactedErrorText(error, [secret]), 'preflight [REDACTED] / [REDACTED] / [PHONE]');
  assert.equal(error.message, message);
  assert.equal(error.cause, cause);
  assert.equal(errorText(error), message);
  assert.equal(redactedErrorText(new Error('x'.repeat(4500))).length, 4000);
});

test('empty and non-Error rejections always produce a nonempty safe RPC error', () => {
  const values: unknown[] = [
    new Error(''),
    undefined,
    null,
    false,
    0,
    '',
    'fixtureAlpha789',
    { message: 'fixtureAlpha789', stack: 'private stack' },
    {
      toString() {
        throw new Error('must not coerce a rejection object');
      },
    },
  ];
  for (const value of values) assert.equal(redactedErrorText(value), '请求失败');
});
