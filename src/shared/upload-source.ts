type Known = { known: true; value: unknown; referenced?: boolean } | { known: false };
function knownValue(value: unknown, parameters: Record<string, unknown>): Known {
  if (
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    '$ref' in value &&
    typeof value.$ref === 'string'
  ) {
    const [root, ...parts] = value.$ref.split('.');
    if (root !== 'params') return { known: false };
    if (!parts.length) throw new Error('上传参数引用缺少名称');
    let current: any = parameters;
    for (const key of parts) {
      if (
        !key ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        current == null ||
        !Object.hasOwn(Object(current), key)
      )
        throw new Error('上传参数引用不存在：' + value.$ref);
      current = current[key];
    }
    return { known: true, value: current, referenced: true };
  }
  return { known: true, value };
}
function descriptor(value: unknown): { binding: unknown; name: unknown } {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'binding') ||
    !Object.hasOwn(value, 'name')
  )
    throw new Error('上传必须使用本地文件绑定 {binding,name}');
  return value as { binding: unknown; name: unknown };
}
export function uploadText(value: unknown, field: 'binding' | 'name'): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    throw new Error(
      field === 'binding' ? '上传目录绑定必须是非空文本' : '上传文件名必须是非空文本',
    );
  return value;
}
/** Read only values known from parameters; step and loop outputs remain deferred. */
export function staticUploadFields(
  value: unknown,
  parameters: Record<string, unknown>,
): { binding: Known; name: Known } | undefined {
  const source = knownValue(value, parameters);
  if (!source.known) return;
  const fields = descriptor(source.value);
  // A referenced parameter object is opaque data, exactly as in resolveValue.
  const field = (value: unknown): Known =>
    source.referenced ? { known: true, value } : knownValue(value, parameters);
  return { binding: field(fields.binding), name: field(fields.name) };
}
export function uploadSource(value: unknown): { binding: string; name: string } {
  const fields = descriptor(value);
  return { binding: uploadText(fields.binding, 'binding'), name: uploadText(fields.name, 'name') };
}
