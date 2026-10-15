import ActionButton, { type ActionButtonProps } from './ActionButton';

export default function InspectorAction({
  iconOnly = false,
  ...props
}: ActionButtonProps & { iconOnly?: boolean }) {
  return (
    <ActionButton
      {...props}
      triggerClassName={'inspector-action-trigger' + (iconOnly ? ' inspector-icon-trigger' : '')}
    />
  );
}
