export const supportedConfigurationAdapters = ['flow-parameters-v1', 'template-instance-v1'];
const allowed = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'oneOf',
  'const',
  'title',
  'description',
  'default',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'readOnly',
]);
/** Only a bounded, data-only JSON Schema subset can be rendered or validated. */
export function validateConfigurationSchema(schema: any, depth = 0): void {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || depth > 12)
    throw new Error('模板配置 Schema 无效或层级过深');
  for (const key of Object.keys(schema))
    if (!allowed.has(key)) throw new Error('模板配置 Schema 不支持：' + key);
  if (
    schema.type &&
    !['object', 'array', 'string', 'number', 'integer', 'boolean'].includes(schema.type)
  )
    throw new Error('模板字段类型不支持');
  if (Object.hasOwn(schema, 'minItems') || Object.hasOwn(schema, 'uniqueItems')) {
    if (schema.type !== 'array') throw new Error('数组数量及重复规则须用于明确的array类型');
    if (Object.hasOwn(schema, 'uniqueItems') && typeof schema.uniqueItems !== 'boolean')
      throw new Error('uniqueItems须为布尔值');
  }
  for (const key of ['minItems', 'maxItems'])
    if (Object.hasOwn(schema, key) && (!Number.isSafeInteger(schema[key]) || schema[key] < 0))
      throw new Error('数组项数须为非负安全整数：' + key);
  if (schema.minItems !== undefined && schema.maxItems !== undefined && schema.minItems > schema.maxItems)
    throw new Error('数组最少项数不能超过最多项数');
  if (schema.properties) {
    if (Object.keys(schema.properties).length > 100) throw new Error('模板配置字段过多');
    for (const [key, value] of Object.entries(schema.properties)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw new Error('模板字段名无效');
      validateConfigurationSchema(value, depth + 1);
    }
  }
  if (schema.items) validateConfigurationSchema(schema.items, depth + 1);
  if (schema.oneOf) {
    if (
      !Array.isArray(schema.oneOf) ||
      schema.oneOf.length > 50 ||
      schema.oneOf.some((v: any) => !Object.hasOwn(v, 'const'))
    )
      throw new Error('只支持带 const 的选项列表');
    for (const item of schema.oneOf) validateConfigurationSchema(item, depth + 1);
  }
}
/** Data defaults are form seeds, never invented required values or authority. */
export function schemaDefaults(schema: any): any {
  const derive = (s: any): any => {
    if (!s || typeof s !== 'object') return undefined;
    if (Object.hasOwn(s, 'const')) return structuredClone(s.const);
    if (Object.hasOwn(s, 'default')) return structuredClone(s.default);
    const nullable = s.type === 'null' || Array.isArray(s.type) && s.type.includes('null') ||
      Array.isArray(s.enum) && s.enum.includes(null) ||
      [...(s.anyOf ?? []), ...(s.oneOf ?? [])].some((v: any) => v.type === 'null' || Object.hasOwn(v, 'const') && v.const === null);
    if (nullable) return null;
    if (Array.isArray(s.enum) && s.enum.length) return structuredClone(s.enum[0]);
    if (Array.isArray(s.oneOf) && s.oneOf.length && Object.hasOwn(s.oneOf[0], 'const')) return structuredClone(s.oneOf[0].const);
    if (s.type === 'object') {
      const required = new Set(s.required ?? []), result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(s.properties ?? {}) as [string, any][]) {
        if (!required.has(key) && !Object.hasOwn(child, 'default') && !Object.hasOwn(child, 'const')) continue;
        const value = derive(child);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (s.type === 'array') return (s.minItems ?? 0) > 0 ? undefined : [];
    if (s.type === 'boolean') return false;
    if (s.type === 'integer' || s.type === 'number') {
      const value = s.minimum ?? 0;
      return s.maximum !== undefined && value > s.maximum ? undefined : value;
    }
    if (s.type === 'string') return (s.minLength ?? 0) > 0 ? undefined : '';
    return undefined;
  };
  return derive(schema) ?? null;
}
