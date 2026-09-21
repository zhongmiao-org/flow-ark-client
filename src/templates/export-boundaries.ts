import type { Manifest } from '../../contracts/package-format';
import { walk } from '../core/validate';
import type { Flow } from '../shared/types';

/** Infer editable types, never user values or defaults. */
export function parameterSchema(value: unknown): any {
  if (Array.isArray(value)) {
    const shapes = value.map(parameterSchema);
    const uniform = shapes.every((s) => JSON.stringify(s) === JSON.stringify(shapes[0]));
    return { type: 'array', items: uniform && shapes.length ? shapes[0] : {} };
  }
  if (value && typeof value === 'object')
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, parameterSchema(v)]),
      ),
      required: Object.keys(value),
      additionalProperties: false,
    };
  return value === null ? {} : { type: typeof value };
}

/** Native nodes expose logical resources; machine paths and grants never participate. */
export function declareNativeBoundaries(flow: Flow, manifest: Manifest, entryId: string) {
  const entry = manifest.entries.find((e) => e.id === entryId)!;
  const steps = walk(flow.steps);
  entry.capabilities = [
    ...new Set([...entry.capabilities, ...flow.requiredCapabilities, ...steps.map((n) => n.type)]),
  ];
  const mapped = new Map<string, string>();
  const unique = (prefix: string) => {
    let id = prefix,
      i = 1;
    while (manifest.resources.some((r) => r.id === id)) id = prefix + '-' + i++;
    return id;
  };
  const directory = (logical: string, access: 'read' | 'write') => {
    const old = manifest.resources.find((r) => r.id === (mapped.get(logical) ?? logical));
    if (old && old.kind !== 'directory') throw new Error('资源类型冲突：' + logical);
    let resource = old;
    if (!resource) {
      const id = /^[a-z][a-z0-9-]{0,99}$/.test(logical) ? logical : unique('directory');
      resource = { id, name: logical, kind: 'directory', access, required: true };
      manifest.resources.push(resource);
      mapped.set(logical, id);
    } else if (resource.access !== access) resource.access = 'readwrite';
    if (!entry.resources.includes(resource.id)) entry.resources.push(resource.id);
    return resource.id;
  };
  let writes = false;
  for (const node of steps) {
    if (node.type === 'file' || node.type === 'excel') {
      const access = node.operation === 'read' ? 'read' : 'write';
      node.binding = directory(node.binding, access);
      writes ||= access === 'write';
    }
    if (node.type === 'http') writes ||= node.method !== 'GET';
    if (node.type === 'browser') {
      let browser = manifest.resources.find(
        (r) => r.kind === 'browser' && entry.resources.includes(r.id),
      );
      if (!browser) {
        browser = {
          id: unique('browser'),
          name: '浏览器',
          kind: 'browser',
          access: 'use',
          required: true,
        };
        manifest.resources.push(browser);
        entry.resources.push(browser.id);
      }
      writes ||= ['click', 'fill', 'select', 'check', 'press', 'upload'].includes(node.operation);
      if (node.operation === 'upload') {
        const value = node.value as any;
        if (!value || typeof value.binding !== 'string')
          throw new Error('导出上传节点前，请将目录设为固定的逻辑绑定名称');
        node.value = { ...value, binding: directory(value.binding, 'read') };
      }
    }
  }
  if (writes && !entry.actions.length) {
    let id = 'workflow-write',
      i = 1;
    while (manifest.actions.some((a) => a.id === id)) id = 'workflow-write-' + i++;
    manifest.actions.push({
      id,
      name: '执行流程写入',
      description: '允许此入口的文件写入、网页修改和外部请求；执行范围以流程定义为准',
      default: 'deny',
    });
    entry.actions.push(id);
  }
}
