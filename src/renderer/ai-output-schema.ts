import { assertAISchema } from '../shared/ai-node';
import type { Json } from '../shared/types';

export type AIOutputSchema = Record<string, Json> & { type: 'object' };

export function checkAIOutputSchema(value: unknown): asserts value is AIOutputSchema {
  assertAISchema(value);
  const visit = (schema: any, path: string) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return;
    for (const [minimum, maximum, label] of [
      ['minLength', 'maxLength', '字符数'],
      ['minItems', 'maxItems', '项数'],
      ['minimum', 'maximum', '数值'],
      ['minProperties', 'maxProperties', '字段数'],
    ]) {
      if (
        typeof schema[minimum] === 'number' &&
        typeof schema[maximum] === 'number' &&
        schema[minimum] > schema[maximum]
      )
        throw Error(path + '的' + label + '下限大于上限，请修正后应用。');
    }
    for (const key of [
      'properties',
      'patternProperties',
      '$defs',
      'definitions',
      'dependentSchemas',
    ])
      if (schema[key] && typeof schema[key] === 'object' && !Array.isArray(schema[key]))
        for (const [name, child] of Object.entries(schema[key])) visit(child, path + ' / ' + name);
    for (const key of [
      'items',
      'prefixItems',
      'allOf',
      'anyOf',
      'oneOf',
      'not',
      'if',
      'then',
      'else',
      'additionalProperties',
      'additionalItems',
      'contains',
      'propertyNames',
      'unevaluatedProperties',
      'unevaluatedItems',
    ]) {
      const child = schema[key];
      if (Array.isArray(child))
        child.forEach((item, index) => visit(item, path + ' / ' + key + index));
      else visit(child, path + ' / ' + (key === 'items' ? '数组项' : key));
    }
  };
  visit(value, '输出结构');
}
