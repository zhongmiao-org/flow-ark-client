import { useRef, useState } from 'react';
import { Clock, Plus, Pencil } from 'lucide-react';
import type { Bootstrap, FlowRecord, Schedule } from '../shared/types';
import { scheduleCreateSchema, scheduleUpdateSchema } from '../shared/schedules';
import { ZodError } from 'zod';

type Props = {
  data: Bootstrap;
  action: (fn: () => Promise<any>, message?: string) => Promise<any>;
};
type Edit = {
  plan: Schedule;
  flow?: FlowRecord;
  minutes: string;
  timezone: string;
  adoptLatest: boolean;
};
const api = (method: string, args: any) => window.flowark.request(method, args);
function inZone(time: number, timezone: string) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      dateStyle: 'medium',
      timeStyle: 'medium',
      hour12: false,
    }).format(time);
  } catch {
    return '时间不可用，请检查时区';
  }
}
function Timing({
  minutes,
  timezone,
  onChange,
  editing = false,
}: {
  minutes: string;
  timezone: string;
  onChange: (change: Partial<Pick<Edit, 'minutes' | 'timezone'>>) => void;
  editing?: boolean;
}) {
  return (
    <>
      <label>
        <span>间隔（分钟）</span>
        <input
          aria-label={editing ? '计划间隔分钟' : '创建间隔分钟'}
          type="number"
          min={1}
          max={525600}
          step={1}
          required
          value={minutes}
          onChange={(e) => onChange({ minutes: e.target.value })}
        />
      </label>
      <label>
        <span>时区</span>
        <input
          aria-label={editing ? '计划时区' : '创建时区'}
          list="schedule-timezones"
          required
          value={timezone}
          onChange={(e) => onChange({ timezone: e.target.value })}
        />
      </label>
    </>
  );
}
export default function Schedules({ data, action }: Props) {
  const [flowId, setFlow] = useState('');
  const [timing, setTiming] = useState({
    minutes: '30',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  const [edit, setEdit] = useState<Edit>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  async function perform(fn: () => Promise<any>, message?: string) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      return await action(async () => {
        try {
          return await fn();
        } catch (e) {
          const message =
            e instanceof ZodError
              ? e.issues.map((issue) => issue.message).join('；')
              : e instanceof Error
                ? e.message
                : String(e);
          setError(message);
          throw new Error(message);
        }
      }, message);
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  function open(plan: Schedule) {
    setError('');
    setEdit({
      plan: structuredClone(plan),
      flow: structuredClone(data.flows.find((f) => f.id === plan.flowId)),
      minutes: String(plan.intervalMinutes),
      timezone: plan.timezone,
      adoptLatest: false,
    });
  }
  async function save() {
    if (!edit) return;
    const result = await perform(() => {
      const args = scheduleUpdateSchema.parse({
        id: edit.plan.id,
        revision: edit.plan.revision ?? null,
        intervalMinutes: Number(edit.minutes),
        timezone: edit.timezone,
        adoptLatest: edit.adoptLatest,
        ...(edit.adoptLatest ? { flowUpdatedAt: edit.flow?.updatedAt } : {}),
      });
      return api('schedule.update', args);
    }, '计划已更新，启停状态保持不变');
    if (result) setEdit(undefined);
  }
  return (
    <div className="page schedules-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">FLOWARK WORKSPACE</span>
          <h1>让流程按时开始</h1>
          <p>仅在应用驻留时生效。退出或休眠期间不补跑。</p>
        </div>
      </div>
      <datalist id="schedule-timezones">
        {['Asia/Shanghai', 'UTC', 'Asia/Tokyo', 'America/New_York', 'Europe/London'].map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
      <form
        className="panel schedule-form"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(
            () =>
              api(
                'schedule.save',
                scheduleCreateSchema.parse({
                  flowId,
                  intervalMinutes: Number(timing.minutes),
                  timezone: timing.timezone,
                }),
              ),
            '计划已创建，固定引用当前版本',
          );
        }}
      >
        <fieldset disabled={pending}>
          <legend>创建计划</legend>
          <div className="schedule-fields">
            <label>
              <span>流程</span>
              <select
                aria-label="计划流程"
                required
                value={flowId}
                onChange={(e) => setFlow(e.target.value)}
              >
                <option value="">选择流程</option>
                {data.flows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.flow.name}
                  </option>
                ))}
              </select>
            </label>
            <Timing
              {...timing}
              onChange={(change) => setTiming((old) => ({ ...old, ...change }))}
            />
          </div>
          <div className="schedule-actions">
            <small>间隔从保存时起算；时区用于显示计划时间。</small>
            <button type="submit" className="primary" disabled={!flowId}>
              <Plus size={15} />
              创建计划
            </button>
          </div>
        </fieldset>
      </form>
      {error && (
        <p className="field-error schedule-error" role="alert">
          {error}
        </p>
      )}
      {!data.schedules.length && (
        <p className="schedule-empty">还没有计划。选择一个已保存的流程，即可安排定时执行。</p>
      )}
      {data.schedules.map((s) => {
        const editing = edit?.plan.id === s.id;
        const name = data.flows.find((f) => f.id === s.flowId)?.flow.name ?? '流程已不可用';
        const changed =
          editing &&
          ((s.revision ?? null) !== (edit.plan.revision ?? null) ||
            (edit.adoptLatest &&
              data.flows.find((f) => f.id === s.flowId)?.updatedAt !== edit.flow?.updatedAt));
        return (
          <section
            className="schedule schedule-card"
            key={s.id}
            data-schedule-id={s.id}
            aria-label={'计划 ' + name}
          >
            <div className="schedule-summary">
              <Clock size={21} />
              <div className="schedule-description">
                <b>{name}</b>
                <p>
                  每 {s.intervalMinutes} 分钟 · {s.timezone} · 固定版本{' '}
                  <code>{s.versionId.slice(0, 8)}</code>
                </p>
                <small>
                  {s.enabled
                    ? `下次：${inZone(s.nextAt, s.timezone)}`
                    : '已暂停 · 启用后重新计算下次时间'}
                </small>
              </div>
              <div className="schedule-buttons">
                <button disabled={pending} onClick={() => open(s)}>
                  <Pencil size={14} />
                  编辑计划
                </button>
                <button
                  disabled={pending}
                  onClick={() =>
                    void perform(() => api('schedule.toggle', { id: s.id, enabled: !s.enabled }))
                  }
                >
                  {s.enabled ? '暂停计划' : '启用计划'}
                </button>
              </div>
            </div>
            {editing && (
              <form
                className="schedule-edit"
                aria-label="编辑本机计划"
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <fieldset disabled={pending}>
                  <legend>修改计划</legend>
                  <div className="schedule-fields">
                    <Timing
                      minutes={edit.minutes}
                      timezone={edit.timezone}
                      editing
                      onChange={(change) => setEdit({ ...edit, ...change })}
                    />
                  </div>
                  <label className="schedule-adoption">
                    <input
                      type="checkbox"
                      checked={edit.adoptLatest}
                      disabled={!edit.flow}
                      onChange={(e) => setEdit({ ...edit, adoptLatest: e.target.checked })}
                    />
                    <span>采用当前已保存的流程版本</span>
                  </label>
                  <p className="schedule-version-note">
                    {edit.adoptLatest && edit.flow
                      ? `${edit.flow.flow.name} · 保存于 ${inZone(Date.parse(edit.flow.updatedAt), edit.timezone)}。未保存的编辑不在其中。`
                      : `继续使用固定版本 ${edit.plan.versionId.slice(0, 8)}，只调整时间设置。`}
                  </p>
                  <p className="schedule-version-note">
                    {edit.plan.enabled
                      ? '保存后仍保持启用，下次时间从保存时重新计算。'
                      : '保存后仍保持暂停，不会启动任务。'}{' '}
                    已经排队或运行的任务保持原版本。
                  </p>
                  {changed && (
                    <p className="field-error" role="alert">
                      计划或已保存流程已改变，请取消编辑后重新核对。
                    </p>
                  )}
                  <div className="schedule-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEdit(undefined);
                        setError('');
                      }}
                    >
                      取消编辑
                    </button>
                    <button type="submit" className="primary" disabled={changed}>
                      {pending ? '正在保存…' : '保存计划'}
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
