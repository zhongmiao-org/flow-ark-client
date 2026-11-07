import { digest } from '../shared/utils';
import { aiUsage } from '../shared/ai-outcome';

/** Stable audit identities prevent counting inherited history twice. */
export function projectAIUsage(tasks: { id?: string; history: { kind: string; value: unknown }[] }[]) {
  const calls = new Map<string, ReturnType<typeof aiUsage>>();
  for (const task of tasks) {
    const parent = task.history.find(e => e.kind === 'user-continuation')?.value as any;
    let prefix = parent?.parentTaskId ?? task.id ?? '';
    for (const event of task.history) {
      prefix = digest({ prefix, event });
      if (!['request-start', 'model', 'request-failure'].includes(event.kind)) continue;
      const value = event.value as any, key = value.callId ?? prefix;
      if (event.kind === 'request-start') { if (!calls.has(key)) calls.set(key, null); }
      else calls.set(key, aiUsage(value.usage));
    }
  }
  let input: number | null = null, output: number | null = null, total: number | null = null, missing = 0;
  for (const usage of calls.values()) {
    const a = usage?.input_tokens ?? usage?.prompt_tokens;
    const b = usage?.output_tokens ?? usage?.completion_tokens;
    const c = usage?.total_tokens ?? (a !== undefined && b !== undefined ? a + b : undefined);
    if (a !== undefined) input = (input ?? 0) + a;
    if (b !== undefined) output = (output ?? 0) + b;
    if (c !== undefined) total = (total ?? 0) + c;
    if (a === undefined || b === undefined || c === undefined) missing++;
  }
  return { input, output, total, calls: calls.size, missing };
}
