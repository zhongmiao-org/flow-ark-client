import type { ErrorObject } from 'ajv';

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const own = (v: unknown, key: string): unknown =>
  (object(v) || Array.isArray(v)) && Object.hasOwn(v, key)
    ? (v as Record<string, unknown>)[key]
    : undefined;
function pointer(value: unknown, path: string): unknown {
  if (!path) return value;
  if (!path.startsWith('/') || path.length > 2000) return undefined;
  for (const part of path.slice(1).split('/'))
    value = own(value, part.replace(/~1/g, '/').replace(/~0/g, '~'));
  return value;
}
const labelText = (value: unknown): string =>
  typeof value === 'string'
    ? [...value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim()]
        .slice(0, 60)
        .join('')
    : '';
const types: Record<string, string> = {
  string: '文本',
  number: '数字',
  integer: '整数',
  boolean: '是或否',
  object: '对象',
  array: '列表',
  null: '空值',
};

/** Local diagnostic only. Never copy AJV messages, output values or undeclared keys. */
export function outputFieldFeedback(
  schema: unknown,
  output: unknown,
  errors: readonly ErrorObject[] | null | undefined,
): string {
  const prefix = '模型返回的字段不符合要求：';
  const reasons: string[] = [];
  for (const e of errors ?? []) {
    // A branch-local failure need not be the reason a union is invalid.
    if (e.keyword === 'anyOf' || e.keyword === 'oneOf')
      return prefix + '字段类型或组合不符合模板定义，未采用此结果。';
  }
  for (const e of errors ?? []) {
    let path: string;
    try {
      path = decodeURIComponent(e.schemaPath);
    } catch {
      continue;
    }
    if (!path.startsWith('#/')) continue;
    const parentPath = path.slice(1, path.lastIndexOf('/'));
    const definition = pointer(schema, parentPath);
    if (!object(definition)) continue;
    const parts = parentPath.split('/');
    const declaredKeys = parts.flatMap((part, i) =>
      parts[i - 1] === 'properties' ? [part.replace(/~1/g, '/').replace(/~0/g, '~')] : [],
    );
    let label = labelText(definition.title) || labelText(declaredKeys.join('.')) || '结果';
    const limit = definition[e.keyword];
    const boundedLimit =
      typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 0 && limit <= 1e9;
    const value = pointer(output, e.instancePath);
    let reason = '';
    switch (e.keyword) {
      case 'maxLength':
      case 'minLength':
        if (boundedLimit) {
          const count = typeof value === 'string' ? [...value].length : undefined;
          reason =
            `${e.keyword === 'maxLength' ? '最多' : '至少'}${limit}字符` +
            (count === undefined ? '' : `，模型返回了${count}字符`);
        }
        break;
      case 'maxItems':
      case 'minItems':
        if (boundedLimit)
          reason =
            `${e.keyword === 'maxItems' ? '最多' : '至少'}${limit}项` +
            (Array.isArray(value) ? `，模型返回了${value.length}项` : '');
        break;
      case 'type': {
        const expected = Array.isArray(definition.type) ? definition.type : [definition.type];
        const labels = expected.map((v) => typeof v === 'string' && types[v]);
        if (labels.length && labels.every(Boolean)) reason = '需要' + labels.join('或');
        break;
      }
      case 'required': {
        const key = e.params.missingProperty;
        if (
          typeof key === 'string' &&
          Array.isArray(definition.required) &&
          definition.required.includes(key)
        ) {
          const child = own(definition.properties, key);
          label = (object(child) && labelText(child.title)) || labelText(key) || '必填字段';
        }
        reason = '缺少必填内容';
        break;
      }
      case 'additionalProperties':
        reason = '包含未声明字段';
        break;
      case 'enum':
        reason = '不在允许的选项中';
        break;
      case 'const':
        reason = '与固定要求不一致';
        break;
      case 'pattern':
      case 'format':
        reason = '格式不符合要求';
        break;
      case 'minimum':
      case 'maximum':
      case 'exclusiveMinimum':
      case 'exclusiveMaximum':
        reason = '数字超出允许范围';
        break;
      case 'uniqueItems':
        reason = '包含不允许的重复项';
        break;
    }
    if (reason) {
      const summary = label + '：' + reason;
      if (!reasons.includes(summary)) reasons.push(summary);
      if (reasons.length === 2) break;
    }
  }
  return (
    prefix + (reasons.join('；') || '请核对模板结果字段的类型、必填项与限制') + '。未采用此结果。'
  );
}
