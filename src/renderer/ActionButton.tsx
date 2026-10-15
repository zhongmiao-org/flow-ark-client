import { Button, ConfigProvider, Tooltip } from 'antd';
import type { ComponentProps } from 'react';
import './action-button.css';

export type ActionButtonProps = ComponentProps<typeof Button> & {
  hint: string;
  stretch?: boolean;
  triggerClassName?: string;
};

export default function ActionButton({
  hint,
  stretch = false,
  triggerClassName = '',
  disabled,
  'aria-label': ariaLabel,
  title: _nativeTitle,
  ...props
}: ActionButtonProps) {
  const { componentDisabled } = ConfigProvider.useConfig();
  const unavailable = disabled ?? componentDisabled;
  return (
    <Tooltip title={hint} trigger={['hover', 'focus']}>
      <span
        className={['action-trigger', stretch && 'action-trigger-stretch', triggerClassName]
          .filter(Boolean)
          .join(' ')}
        tabIndex={unavailable ? 0 : undefined}
        aria-label={unavailable ? hint : undefined}
        aria-disabled={unavailable || undefined}
      >
        <Button
          {...props}
          disabled={unavailable}
          aria-label={ariaLabel}
          aria-busy={props['aria-busy'] ?? (props.loading ? true : undefined)}
        />
      </span>
    </Tooltip>
  );
}
