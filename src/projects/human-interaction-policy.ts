import { transform } from 'esbuild';
import { ProjectDiagnostic } from './configuration';

export const humanExecutionMode = 'desktop-human-v1' as const;
export type ExecutionMode = typeof humanExecutionMode;

/** Authoring/compilation admission for trusted code, not a JavaScript sandbox. */
export function assertHumanPlan(plan: {
  executionMode?: ExecutionMode;
  resources: unknown[];
  entries: { id: string; capabilities: string[]; steps?: Record<string, unknown>[] }[];
  dependencies?: unknown[];
}) {
  if (plan.executionMode !== humanExecutionMode) return;
  if (plan.dependencies?.length)
    throw new ProjectDiagnostic('human-mode-dependency', '拟人流程不允许外部脚本依赖');
  if (
    plan.resources.some(
      (r) =>
        typeof r === 'object' &&
        r !== null &&
        ['browser', 'ai'].includes(String((r as Record<string, unknown>).kind)),
    )
  )
    throw new ProjectDiagnostic(
      'human-mode-resource',
      '拟人流程只通过已绑定窗口观察和输入，不允许浏览器或 AI 运行资源',
    );
  const inspect = (entryId: string, steps: Record<string, unknown>[]) => {
    for (const node of steps) {
      if (['browser', 'ai', 'conversation', 'http', 'shell'].includes(String(node.type)))
        throw new ProjectDiagnostic(
          'human-mode-node',
          '拟人流程不允许网页语义、网络、模型或进程节点',
          undefined,
          entryId + '.' + node.id,
        );
      for (const branch of ['then', 'else', 'body'])
        if (Array.isArray(node[branch]))
          inspect(entryId, node[branch] as Record<string, unknown>[]);
    }
  };
  for (const entry of plan.entries) {
    if (
      entry.capabilities.some((c) =>
        /^(?:browser|ai|conversation|http|network|shell|process)(?:[-.:/]|$)/i.test(c),
      )
    )
      throw new ProjectDiagnostic(
        'human-mode-capability',
        '拟人流程不允许浏览器、网络、模型或进程能力',
        undefined,
        entry.id,
      );
    inspect(entry.id, entry.steps ?? []);
  }
}

/** Conservative static admission. Runtime permissions and immutable review still apply. */
export async function assertHumanSource(source: string, path: string, language: 'js' | 'ts') {
  // esbuild removes type-only imports, comments and normalizes escaped identifiers.
  const { code } = await transform(source, {
    loader: language,
    format: 'esm',
    target: 'es2022',
    legalComments: 'none',
  });
  const forbidden = [
    /\b(?:import|require)\s*\(/,
    /\b(?:import|export)\s[^;]*?\bfrom\s*["'](?:node:|https?:|data:|file:|[^.])/,
    /\bimport\s*["']/,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|navigator|document|window|globalThis|global|process|require|module|exports|eval|Function|Reflect|Proxy)\b/,
    /\b(?:browser|ai)\s*(?:\(|[:;,}=])/,
    /["'](?:browser|ai|fetch|process|constructor|__proto__)["']/,
    /\.\s*(?:browser|ai|constructor|__proto__)\b/,
    /\b(?:node:|chrome-devtools|playwright|puppeteer|selenium|child_process)\b/,
  ];
  if (forbidden.some((pattern) => pattern.test(code)))
    throw new ProjectDiagnostic(
      'human-mode-source',
      '拟人流程脚本只能使用正式桌面、文件和状态 SDK；不允许浏览器、网络、模型、进程、动态加载或动态代码路径',
      path,
    );
}
