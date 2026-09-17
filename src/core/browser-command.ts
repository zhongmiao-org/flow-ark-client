// Paths are per command; callers must never keep a sticky current frame.
export function framePathOf(command: { operation: string; framePath?: unknown }): string[] {
  const path = command.framePath === undefined ? [] : command.framePath;
  if (
    !Array.isArray(path) ||
    path.length > 8 ||
    path.some((s) => typeof s !== 'string' || !s.trim() || s.length > 2000)
  )
    throw new Error('框架路径需为最多 8 层的非空 CSS 选择器数组');
  if (
    path.length &&
    ![
      'read',
      'count',
      'attribute',
      'click',
      'fill',
      'wait',
      'upload',
      'download',
      'select',
      'check',
      'inputValue',
      'press',
    ].includes(command.operation)
  )
    throw new Error('此操作只支持顶层页面，框架路径必须为空');
  return [...path];
}

export const formKeys = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Tab',
  'Enter',
  'Escape',
  'Space',
  'Backspace',
  'Delete',
] as const;
export function validateFormCommand(
  command: { operation: string; value?: unknown },
  allowReference = false,
) {
  const value = command.value;
  if (
    allowReference &&
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    '$ref' in value &&
    typeof value.$ref === 'string'
  )
    return;
  if (command.operation === 'select') {
    const values = typeof value === 'string' ? [value] : value;
    if (
      !Array.isArray(values) ||
      values.length > 100 ||
      values.some((v) => typeof v !== 'string' || v.length > 2000) ||
      new Set(values).size !== values.length
    )
      throw new Error('select 需要字符串或最多 100 个不重复字符串');
  }
  if (command.operation === 'check' && typeof value !== 'boolean')
    throw new Error('check 需要布尔值');
  if (command.operation === 'inputValue' && value !== null)
    throw new Error('inputValue 的 value 必须为空');
  if (command.operation === 'press' && !formKeys.includes(value as any))
    throw new Error('不支持的表单按键');
}
