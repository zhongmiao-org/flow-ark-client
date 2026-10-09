export function inZone(time: number, timezone: string) {
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
export function Timing({
  minutes,
  timezone,
  onChange,
  editing = false,
}: {
  minutes: string;
  timezone: string;
  onChange: (change: Partial<{ minutes: string; timezone: string }>) => void;
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
