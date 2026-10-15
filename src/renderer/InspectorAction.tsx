import { Button, Tooltip, type ButtonProps } from 'antd';

export default function InspectorAction({
  hint,
  iconOnly = false,
  disabled,
  'aria-label': ariaLabel,
  ...props
}: ButtonProps & { hint: string; iconOnly?: boolean }) {
  return (
    <Tooltip title={hint} trigger={['hover', 'focus']}>
      <span
        className={'inspector-action-trigger' + (iconOnly ? ' inspector-icon-trigger' : '')}
        tabIndex={disabled ? 0 : undefined}
        aria-label={disabled ? hint : undefined}
        aria-disabled={disabled || undefined}
      >
        <Button {...props} disabled={disabled} aria-label={ariaLabel ?? hint} />
      </span>
    </Tooltip>
  );
}
