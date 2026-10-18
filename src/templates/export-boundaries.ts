import type { Manifest } from '../../contracts/package-format';
import { walk } from '../core/validate';
import type { Flow } from '../shared/types';
import { assertPortableSourceFlow } from './source-boundaries';

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
export function declareNativeBoundaries(
  flow: Flow,
  manifest: Manifest,
  entryId: string,
  declaredActionIds?: string[],
) {
  assertPortableSourceFlow(flow);
  const entry = manifest.entries.find((e) => e.id === entryId)!;
  const hadDeclaredActions = entry.actions.length > 0;
  const declared = declaredActionIds ?? [...entry.actions];
  const requireAction = (prefix: string, name: string, description: string) => {
    // Author compilation merges explicit actions after inference. A package copy
    // already has the canonical declaration, but only its own entry may reuse it.
    const existing = manifest.actions.find(
      (a) =>
        declared.includes(a.id) &&
        a.name === name &&
        a.description === description &&
        a.default === 'deny',
    );
    if (existing) {
      if (!entry.actions.includes(existing.id)) entry.actions.push(existing.id);
      return;
    }
    let id = prefix,
      i = 1;
    while (manifest.actions.some((a) => a.id === id)) id = prefix + '-' + i++;
    manifest.actions.push({ id, name, description, default: 'deny' });
    entry.actions.push(id);
  };
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
  const directory = (logical: string, access: 'read' | 'write' | 'readwrite') => {
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
    if (node.type === 'context') {
      for (const c of [
        'template-data-v1',
        ...(node.operation !== 'configuration' ? ['state'] : []),
      ])
        if (!entry.capabilities.includes(c)) entry.capabilities.push(c);
    }
    if (node.type === 'file' || node.type === 'excel') {
      const access = node.operation === 'read' ? 'read' : 'write';
      node.binding = directory(node.binding, access);
      writes ||= access === 'write';
    }
    if (node.type === 'source' || node.type === 'source-reduce') {
      const old = manifest.resources.find((r) => r.id === node.binding);
      if (old && (old.kind !== 'conversation-source' || old.access !== 'read'))
        throw Error('完整来源资源类型冲突');
      if (!old)
        manifest.resources.push({
          id: node.binding,
          name: node.binding,
          kind: 'conversation-source',
          access: 'read',
          required: true,
        });
      if (!entry.resources.includes(node.binding)) entry.resources.push(node.binding);
      if (!entry.capabilities.includes('conversation-source-read-v1'))
        entry.capabilities.push('conversation-source-read-v1');
    }
    if (node.type === 'source-reduce') {
      for (const c of ['source-reduce-v1', 'ai-node-v1', 'conversation-source-read-v1']) {
        if (!entry.capabilities.includes(c)) entry.capabilities.push(c);
        if (!flow.requiredCapabilities.includes(c)) flow.requiredCapabilities.push(c);
      }
      const old = manifest.resources.find((r) => r.id === node.aiBinding);
      if (old && (old.kind !== 'ai' || old.access !== 'use')) throw Error('整理AI资源类型冲突');
      if (!old)
        manifest.resources.push({
          id: node.aiBinding,
          name: node.aiBinding,
          kind: 'ai',
          access: 'use',
          required: true,
        });
      if (!entry.resources.includes(node.aiBinding)) entry.resources.push(node.aiBinding);
    }
    if (node.type === 'skill') {
      if (node.operation === 'propose') {
        for (const key of ['markdown', 'data', 'evidence', 'base'] as const) {
          const value = node[key];
          const reference =
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Object.keys(value).length === 1 &&
            typeof (value as any).$ref === 'string';
          const neutral =
            value === null ||
            value === '' ||
            (Array.isArray(value) && !value.length) ||
            (value && typeof value === 'object' && !Object.keys(value).length);
          if (!reference && !neutral)
            throw Error(
              `Skill步骤${node.id}的${key}含固定个人内容，请改为参数或前序结果引用后导出`,
            );
        }
        node.binding = directory(node.binding, 'readwrite');
      } else {
        const old = manifest.resources.find((r) => r.id === node.binding);
        if (old && (old.kind !== 'skill' || old.access !== 'read'))
          throw Error('Skill资源类型冲突：' + node.binding);
        if (!old)
          manifest.resources.push({
            id: node.binding,
            name: node.binding,
            kind: 'skill',
            access: 'read',
            required: true,
          });
        if (!entry.resources.includes(node.binding)) entry.resources.push(node.binding);
      }
    }
    if (node.type === 'document') node.binding = directory(node.binding, 'read');
    if (node.type === 'ai' || node.type === 'conversation') {
      const old = manifest.resources.find((r) => r.id === node.binding);
      if (old && (old.kind !== 'ai' || old.access !== 'use'))
        throw new Error('AI 资源类型冲突：' + node.binding);
      if (!old)
        manifest.resources.push({
          id: node.binding,
          name: node.binding,
          kind: 'ai',
          access: 'use',
          required: true,
        });
      if (!entry.resources.includes(node.binding)) entry.resources.push(node.binding);
      const capability =
        node.type === 'ai'
          ? 'ai-node-v1'
          : node.version === 2
            ? 'conversation-v2'
            : 'conversation-v1';
      if (!entry.capabilities.includes(capability)) entry.capabilities.push(capability);
      if (node.type === 'ai' && node.version === 2) {
        if (!entry.capabilities.includes('ai-outcome-v1')) entry.capabilities.push('ai-outcome-v1');
        if (!flow.requiredCapabilities.includes('ai-outcome-v1'))
          flow.requiredCapabilities.push('ai-outcome-v1');
      }
      if (node.type === 'conversation') {
        const evidenceCapability =
          node.version === 2 ? 'conversation-checkpoint-v1' : 'conversation-evidence-v1';
        if (!entry.capabilities.includes('conversation')) entry.capabilities.push('conversation');
        if (!entry.capabilities.includes(evidenceCapability))
          entry.capabilities.push(evidenceCapability);
        for (const c of [capability, evidenceCapability])
          if (!flow.requiredCapabilities.includes(c)) flow.requiredCapabilities.push(c);
      }
      if (!entry.capabilities.includes('ai')) entry.capabilities.push('ai');
    }
    if (node.type === 'http') writes ||= node.method !== 'GET';
    if (node.type === 'browser') {
      if (node.version === 4) {
        if (!entry.capabilities.includes('browser-observe-v1'))
          entry.capabilities.push('browser-observe-v1');
        if (!flow.requiredCapabilities.includes('browser-observe-v1'))
          flow.requiredCapabilities.push('browser-observe-v1');
      }
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
  if (steps.some((n) => n.type === 'context' && n.operation === 'state.write')) {
    requireAction(
      'state-write',
      '更新模板状态',
      '按预期修订替换本实例的完整状态；提交后不因运行取消而撤销',
    );
  }
  if (writes && !hadDeclaredActions) {
    requireAction(
      'workflow-write',
      '执行流程写入',
      '允许此入口的文件写入、网页修改和外部请求；执行范围以流程定义为准',
    );
  }
}
