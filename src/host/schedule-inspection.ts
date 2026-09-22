import type { Store } from './store';
import type { FlowRecord, Run, Schedule } from '../shared/types';
import { scheduleInspectSchema, type ScheduleInspection } from '../shared/schedules';

export function inspectSchedule(
  store: Store,
  args: unknown,
  redact: (text: string) => string,
): ScheduleInspection {
  const { id, cursor } = scheduleInspectSchema.parse(args);
  const plan = store.get<Schedule>('schedule', id);
  if (!plan) throw new Error('计划不存在，请返回计划列表');
  const version = store.get<FlowRecord>('version', plan.versionId);
  const ceiling = Math.min(
    cursor?.ceiling ?? store.lastPosition('schedule-log'),
    store.lastPosition('schedule-log'),
  );
  let before = Math.min(cursor?.before ?? ceiling + 1, ceiling + 1);
  const records: ScheduleInspection['records'] = [];
  let more = false;
  for (;;) {
    const rows = store.page<any>('schedule-log', ceiling, before, 200);
    if (!rows.length) break;
    for (const { position, value } of rows) {
      before = position;
      if (value.scheduleId !== id) continue;
      if (records.length === 20) {
        more = true;
        break;
      }
      const reason = typeof value.reason === 'string' ? value.reason : '原因未报告';
      const missed = ['application-restart', 'system-resume', 'sleep-or-clock-gap'].includes(
        reason,
      );
      const times = Object.fromEntries(
        ['time', 'from', 'to']
          .filter(
            (key) =>
              typeof value[key] === 'number' &&
              Number.isFinite(value[key]) &&
              Math.abs(value[key]) <= 8640000000000000,
          )
          .map((key) => [key, value[key]]),
      );
      records.push({
        position,
        kind: reason === 'occupied' ? 'occupied' : missed ? 'missed' : 'failed',
        reason: redact(reason),
        ...times,
      });
    }
    if (more || rows.length < 200) break;
  }
  const active = store
    .list<Run>('run')
    .find(
      (run) =>
        run.scheduleId === id &&
        !['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(run.state),
    );
  return {
    plan,
    version: version
      ? { id: plan.versionId, name: version.flow.name, savedAt: version.updatedAt }
      : null,
    records,
    nextCursor: more ? { scheduleId: id, ceiling, before: records.at(-1)!.position } : null,
    activeRun: active ? { id: active.id, name: active.name, state: active.state } : null,
  };
}
