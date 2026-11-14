/** Self-contained for the selected website's isolated world. Never dispatches input. */
export function browserInputBlockReason(
  element: Element,
  modifying = false,
  key?: string,
): string | null {
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
    const tag = element.tagName;
    const inputType = tag === 'INPUT' ? (element as HTMLInputElement).type : '';
    const textTypes = [
      'text',
      'search',
      'url',
      'tel',
      'email',
      'password',
      'date',
      'month',
      'week',
      'time',
      'datetime-local',
      'number',
    ];
    let role = element.getAttribute('role')?.trim().split(/\s+/)[0];
    if (!role) {
      if (tag === 'TEXTAREA') role = 'textbox';
      else if (tag === 'SELECT')
        role =
          (element as HTMLSelectElement).multiple || (element as HTMLSelectElement).size > 1
            ? 'listbox'
            : 'combobox';
      else if (tag === 'INPUT') {
        if (
          ['text', 'search', 'email', 'tel', 'url'].includes(inputType) &&
          (element as HTMLInputElement).list
        )
          role = 'combobox';
        else if (inputType === 'number') role = 'spinbutton';
        else if (inputType === 'range') role = 'slider';
        else if (inputType === 'checkbox') role = 'checkbox';
        else if (inputType === 'search') role = 'searchbox';
        else if (['text', 'email', 'tel', 'url'].includes(inputType)) role = 'textbox';
      }
    }
    // Caret navigation does not edit a text control; other widgets can change value on these keys.
    if (
      key &&
      ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key) &&
      ['textbox', 'searchbox'].includes(role ?? '')
    )
      return null;
    if (
      (tag === 'TEXTAREA' || (tag === 'INPUT' && textTypes.includes(inputType))) &&
      (element.hasAttribute('readonly') || (element as HTMLInputElement).readOnly === true)
    )
      return 'readonly';
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
