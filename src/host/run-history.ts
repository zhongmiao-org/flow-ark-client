import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { z } from 'zod';
import type { Store } from './store';
import type { Run } from '../shared/types';
import { runListSchema, type RunListPage, type RunOverview } from '../shared/run-history';

const position = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
const cursorSchema = z
  .object({
    v: z.literal(1),
    ceiling: position,
    before: position,
    queryHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export async function listRuns(store: Store, input: unknown): Promise<RunListPage> {
  const args = runListSchema.parse(input);
  const limit = args.limit ?? 50,
    query = (args.query ?? '').trim().toLowerCase();
  const queryHash = createHash('sha256')
    .update(JSON.stringify([limit, query, args.state ?? null, args.source ?? null]))
    .digest('hex');
  let ceiling = store.lastPosition('run'),
    before = ceiling + 1;
  if (args.cursor) {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(args.cursor)) throw new Error();
      const c = cursorSchema.parse(
        JSON.parse(Buffer.from(args.cursor, 'base64url').toString('utf8')),
      );
      if (c.queryHash !== queryHash || c.before > c.ceiling || c.ceiling > ceiling)
        throw new Error();
      ceiling = c.ceiling;
      before = c.before;
    } catch {
      throw new Error('运行记录分页位置无效或筛选已变化，请查看最新记录后重试');
    }
  }
  const matches: { position: number; value: Run }[] = [];
  while (before > 1) {
    const block = store.page<Run>('run', ceiling, before, 200);
    for (const row of block) {
      const r = row.value;
      if (args.state && r.state !== args.state) continue;
      if (args.source && r.source !== args.source) continue;
      if (query && ![r.name, r.id, r.flowId].some((value) => value.toLowerCase().includes(query)))
        continue;
      matches.push(row);
      if (matches.length > limit) break;
    }
    if (matches.length > limit || block.length < 200) break;
    before = block[block.length - 1].position;
    await setImmediate();
  }
  const more = matches.length > limit;
  const rows = matches.slice(0, limit);
  return {
    runs: rows.map((r) => r.value),
    nextCursor: more
      ? Buffer.from(
          JSON.stringify({
            v: 1,
            ceiling,
            before: rows[rows.length - 1].position,
            queryHash,
          }),
        ).toString('base64url')
      : null,
    totalCount: store.count('run'),
    newerCount: store.count('run', ceiling),
  };
}

// Input is newest first, from the full store rather than the history window.
export function runOverview(runs: Run[], now = new Date()): RunOverview {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const today = {
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    total: 0,
    succeeded: 0,
    failed: 0,
    interrupted: 0,
  };
  const latest = new Map<string, Run>();
  let active: Run | null = null,
    queued = 0;
  for (const run of runs) {
    const created = Date.parse(run.createdAt);
    if (created >= start && created < end && created <= now.getTime()) {
      today.total++;
      if (run.state === 'SUCCEEDED') today.succeeded++;
      if (run.state === 'FAILED') today.failed++;
      if (run.state === 'INTERRUPTED') today.interrupted++;
    }
    if (!latest.has(run.flowId)) latest.set(run.flowId, run);
    if (run.state === 'QUEUED') queued++;
    if (!active && ['RUNNING', 'PAUSED', 'WAITING_INPUT', 'CANCELLING'].includes(run.state))
      active = run;
  }
  return { total: runs.length, queued, active, latest: [...latest.values()], today };
}
