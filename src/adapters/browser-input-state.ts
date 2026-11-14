/** Self-contained for the selected website's isolated world. Never dispatches input. */
export function browserInputBlockReason(element: Element, modifying = false): string | null {
  if (!element.isConnected) return 'disconnected';
  if (element.matches(':disabled')) return 'disabled';
  const visited = new Set<Element>();
  let current: Element | null = element;
  while (current && !visited.has(current)) {
    visited.add(current);
    if (
      current.matches(
        'button:disabled,input:disabled,select:disabled,textarea:disabled,option:disabled,optgroup:disabled',
      )
    )
      return 'disabled';
    if (current.hasAttribute('inert')) return 'inert';
    if (current.getAttribute('aria-disabled')?.trim().toLowerCase() === 'true')
      return 'aria-disabled';
    const root = current.getRootNode();
    current =
      current.assignedSlot ??
      current.parentElement ??
      (root instanceof ShadowRoot ? root.host : null);
  }
  if (modifying) {
    if (
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) &&
      (element.hasAttribute('readonly') || (element as HTMLInputElement).readOnly === true)
    )
      return 'readonly';
    const role = element.getAttribute('role')?.trim().split(/\s+/)[0];
    const readonlyRoles = [
      'checkbox',
      'combobox',
      'grid',
      'gridcell',
      'listbox',
      'radiogroup',
      'slider',
      'spinbutton',
      'textbox',
      'columnheader',
      'rowheader',
      'searchbox',
      'switch',
      'treegrid',
    ];
    if (
      role &&
      readonlyRoles.includes(role) &&
      element.getAttribute('aria-readonly')?.trim().toLowerCase() === 'true'
    )
      return 'aria-readonly';
  }
  return null;
}
