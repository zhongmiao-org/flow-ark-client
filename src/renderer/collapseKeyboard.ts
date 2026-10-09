import type { KeyboardEvent } from 'react';

// Ant Design handles Enter; preserve the former summary's Space activation.
export function activateCollapseWithSpace(event: KeyboardEvent<HTMLDivElement>) {
  const target = event.target;
  if (
    event.key === ' ' &&
    !event.repeat &&
    target instanceof HTMLElement &&
    target.getAttribute('role') === 'button' &&
    target.hasAttribute('aria-expanded')
  ) {
    event.preventDefault();
    target.click();
  }
}
