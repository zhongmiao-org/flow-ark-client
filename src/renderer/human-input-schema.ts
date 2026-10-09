import { validateConfigurationSchema } from '../shared/template-config';

// Human requests already accept JSON Schema. Probe only the form's rendering
// support; the original schema still drives fields and host-side validation.
export function validateHumanInputSchema(schema: unknown): void {
  const probe = (value: any, depth = 0): any => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 12)
      throw new Error('人工输入格式无效或层级过深');
    const result = { ...value };
    if (Object.hasOwn(value, 'minItems')) {
      const maximum = value.maxItems ?? 1000;
      if (
        value.type !== 'array' ||
        !Number.isSafeInteger(value.minItems) ||
        value.minItems < 0 ||
        !Number.isSafeInteger(maximum) ||
        maximum < value.minItems
      )
        throw new Error('人工输入列表数量约束无效或超出编辑器范围');
      delete result.minItems;
    }
    if (value.properties)
      result.properties = Object.fromEntries(
        Object.entries(value.properties).map(([key, child]) => [key, probe(child, depth + 1)]),
      );
    if (value.items) result.items = probe(value.items, depth + 1);
    if (value.oneOf) result.oneOf = value.oneOf.map((child: unknown) => probe(child, depth + 1));
    return result;
  };
  validateConfigurationSchema(probe(schema));
}
