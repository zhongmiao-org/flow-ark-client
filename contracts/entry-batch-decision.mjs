/** Unpublished, pure relationship reference. Never a Run or action authorization. */
export const batchCapability = 'entry-batches-v1';
export const batchDecisions = Object.freeze(['continue', 'complete', 'review']);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const length = (value) => [...value].length;
const text = (value, min, max) =>
  typeof value === 'string' && value.trim().length > 0 && value.isWellFormed() && length(value) >= min && length(value) <= max;
const owns = (value, key) => object(value) && Object.hasOwn(value, key);
const exact = (value, names) =>
  object(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
function path(value) {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > 16 ||
    value.some((part) => !text(part, 1, 100) || forbidden.has(part))
  )
    throw Error('批次字段路径无效，请通过字段选择器重新选择');
}
function boundedSchema(schema, maximum) {
  if (
    schema.type !== 'string' ||
    !Number.isSafeInteger(schema.minLength) ||
    schema.minLength < 1 ||
    !Number.isSafeInteger(schema.maxLength) ||
    schema.maxLength < schema.minLength ||
    schema.maxLength > maximum
  )
    throw Error('批次字段需要明确的非空文本及有限长度');
}
function plainSchema(schema) {
  if (
    !object(schema) ||
    ['$ref', '$dynamicRef', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'].some((key) =>
      Object.hasOwn(schema, key),
    )
  )
    throw Error('批次字段不支持复合或引用Schema，请选择明确字段');
}
function field(schema, keys) {
  let current = schema;
  for (const key of keys) {
    plainSchema(current);
    if (
      current.type !== 'object' ||
      !owns(current.properties, key) ||
      !Array.isArray(current.required) ||
      !current.required.includes(key)
    )
      throw Error('批次字段必须是固定结果中的必需对象字段');
    current = current.properties[key];
  }
  plainSchema(current);
  return current;
}
/** The caller independently validates the full fixed result Schema. */
export function assertBatchDeclaration(declaration, resultSchema) {
  if (
    !exact(declaration, ['version', 'decisionPath', 'progressPath', 'reasonPath']) ||
    declaration.version !== 1
  )
    throw Error('连续批次声明无效');
  const paths = [declaration.decisionPath, declaration.progressPath, declaration.reasonPath];
  paths.forEach(path);
  if (new Set(paths.map((keys) => JSON.stringify(keys))).size !== paths.length)
    throw Error('批次决策、进度和说明必须选择不同字段');
  const decision = field(resultSchema, declaration.decisionPath);
  if (
    decision.type !== 'string' ||
    !Array.isArray(decision.enum) ||
    decision.enum.length !== batchDecisions.length ||
    !batchDecisions.every((value) => decision.enum.includes(value)) ||
    ['const', 'pattern', 'format'].some((key) => Object.hasOwn(decision, key)) ||
    (Object.hasOwn(decision, 'minLength') &&
      (!Number.isSafeInteger(decision.minLength) || decision.minLength < 0 || decision.minLength > 6)) ||
    (Object.hasOwn(decision, 'maxLength') &&
      (!Number.isSafeInteger(decision.maxLength) || decision.maxLength < 8))
  )
    throw Error('批次决策必须明确包含继续、完成、需要查看三种枚举');
  boundedSchema(field(resultSchema, declaration.progressPath), 256);
  boundedSchema(field(resultSchema, declaration.reasonPath), 1000);
}
function read(value, keys) {
  let current = value;
  for (const key of keys) {
    if (!owns(current, key)) throw Error('完整结果缺少已声明的批次字段');
    current = current[key];
  }
  return current;
}
/**
 * Input must already be the whole, fixed-Schema-validated original entry result.
 * Output remains private. Identity, authorization and final redaction are host duties.
 */
export function extractBatchDecision(declaration, resultSchema, value) {
  assertBatchDeclaration(declaration, resultSchema);
  const decision = read(value, declaration.decisionPath);
  const progress = read(value, declaration.progressPath);
  const reason = read(value, declaration.reasonPath);
  if (!batchDecisions.includes(decision) || !text(progress, 1, 256) || !text(reason, 1, 1000))
    throw Error('本批决策结果不完整，未安排下一批');
  return { version: 1, decision, progress, reason };
}
