import { useId } from 'react';
import { scheduleTiming } from '../shared/schedules';
import { Input } from 'antd';
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
  const id = useId();
  const minutesError = scheduleTiming.intervalMinutes.safeParse(Number(minutes)).success
    ? ''
    : '请输入 1–525600 之间的整数分钟数。';
  const timezoneError = scheduleTiming.timezone.safeParse(timezone).success
    ? ''
    : '请输入有效时区，例如 Asia/Shanghai 或 UTC。';
  return (
    <>
      <label>
        <span>间隔（分钟）</span>
        <Input
          aria-label={editing ? '计划间隔分钟' : '创建间隔分钟'}
          status={minutesError ? 'error' : undefined}
          aria-invalid={!!minutesError}
          aria-describedby={minutesError ? id + '-minutes' : undefined}
          type="number"
          min={1}
          max={525600}
          step={1}
          required
          value={minutes}
          onChange={(e) => onChange({ minutes: e.target.value })}
        />
        {minutesError && (
          <span id={id + '-minutes'} className="schedule-field-error" role="alert">
            {minutesError}
          </span>
        )}
      </label>
      <label>
        <span>时区</span>
        <Input
          aria-label={editing ? '计划时区' : '创建时区'}
          status={timezoneError ? 'error' : undefined}
          aria-invalid={!!timezoneError}
          aria-describedby={timezoneError ? id + '-timezone' : undefined}
          list="schedule-timezones"
          required
          value={timezone}
          onChange={(e) => onChange({ timezone: e.target.value })}
        />
        {timezoneError && (
          <span id={id + '-timezone'} className="schedule-field-error" role="alert">
            {timezoneError}
          </span>
        )}
      </label>
    </>
  );
}
