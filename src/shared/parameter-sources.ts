import type { Flow, Json } from './types';

export const parameterSourceCapability = 'parameter-sources-v1';
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

export function parameterSourcePath(path: string): string[] {
  const segments = path.split('.');
  if (
    path.length > 2048 ||
    segments.length > 32 ||
    segments.length < 2 ||
    segments[0] !== 'params' ||
    segments.some((segment) => !segment || /\s/.test(segment) || forbidden.has(segment))
  )
    throw new Error(
      '来源表达式只能引用 params.<其他参数名> 及其子路径，最多 32 段；不能含空白或原型属性。',
    );
  return segments.slice(1);
}

/** Resolve only the independent source map; literal JSON stays literal. No IO or code evaluation. */
export function resolveParameterSources(
  flow: Pick<Flow, 'parameters' | 'parameterSources'>,
  values: Record<string, Json> = flow.parameters,
): Record<string, Json> {
  const sources = flow.parameterSources ?? {};
  if (Object.keys(sources).length > 1000) throw new Error('参数来源最多 1000 项。');
  const result = structuredClone(values);
  const completed = new Set<string>();
  const visiting: string[] = [];
  const resolve = (key: string): Json => {
    if (!Object.hasOwn(values, key)) throw new Error('来源参数不存在：' + key);
    if (completed.has(key) || !Object.hasOwn(sources, key)) return result[key];
    if (visiting.includes(key))
      throw new Error('参数来源存在循环引用：' + [...visiting, key].join(' → '));
    if (visiting.length >= 64) throw new Error('参数来源依赖超过 64 层。');
    const source = sources[key];
    if (!source || Object.keys(source).length !== 1 || typeof source.$ref !== 'string')
      throw new Error('参数 ' + key + ' 的来源格式无效。');
    visiting.push(key);
    try {
      const [root, ...fields] = parameterSourcePath(source.$ref);
      let value: Json = resolve(root);
      for (const field of fields) {
        if (
          value === null ||
          typeof value !== 'object' ||
          (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(field)) ||
          !Object.hasOwn(value, field)
        )
          throw new Error('来源路径不存在：' + source.$ref);
        value = (value as Record<string, Json>)[field];
      }
      Object.defineProperty(result, key, {
        value: structuredClone(value),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      completed.add(key);
      return result[key];
    } catch (reason) {
      throw new Error(
        '参数 ' + key + '：' + (reason instanceof Error ? reason.message : '来源不可用'),
      );
    } finally {
      visiting.pop();
    }
  };
  for (const key of Object.keys(sources)) {
    if (!key || key.includes('.') || /\s/.test(key) || forbidden.has(key))
      throw new Error('来源目标参数名无法引用：' + key);
    resolve(key);
  }
  return result;
}

export function withParameterSources(
  flow: Flow,
  sources: NonNullable<Flow['parameterSources']>,
): Flow {
  const next = { ...flow };
  const capabilities = flow.requiredCapabilities.filter((cap) => cap !== parameterSourceCapability);
  if (Object.keys(sources).length) {
    next.parameterSources = sources;
    capabilities.push(parameterSourceCapability);
  } else delete next.parameterSources;
  next.requiredCapabilities = capabilities;
  return next;
}

/** A deleted target loses its own source; a retained source cannot lose its dependency. */
export function changeParameterValues(flow: Flow, parameters: Record<string, Json>): Flow {
  const sources = Object.fromEntries(
    Object.entries(flow.parameterSources ?? {}).filter(([key]) => Object.hasOwn(parameters, key)),
  );
  for (const [key, source] of Object.entries(sources)) {
    const [root] = parameterSourcePath(source.$ref);
    if (!Object.hasOwn(parameters, root))
      throw new Error(
        '不能删除参数 ' +
          root +
          '：参数 ' +
          key +
          ' 的来源仍引用 ' +
          source.$ref +
          '。请先修改来源。',
      );
  }
  // Preserve existing capability declarations for flows that did not use sources.
  return flow.parameterSources
    ? withParameterSources({ ...flow, parameters }, sources)
    : { ...flow, parameters };
}
