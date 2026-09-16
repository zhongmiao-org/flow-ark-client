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
    !['read', 'count', 'attribute', 'click', 'fill', 'wait', 'upload', 'download'].includes(
      command.operation,
    )
  )
    throw new Error('此操作只支持顶层页面，框架路径必须为空');
  return [...path];
}
