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
  'maxItems',
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
export function schemaDefaults(schema: any): any {
  if (Object.hasOwn(schema, 'const')) return structuredClone(schema.const);
  if (Object.hasOwn(schema, 'default')) return structuredClone(schema.default);
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([k, s]) => [k, schemaDefaults(s)]),
    );
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 0;
  return schema.enum?.[0] ?? schema.oneOf?.[0]?.const ?? '';
}
