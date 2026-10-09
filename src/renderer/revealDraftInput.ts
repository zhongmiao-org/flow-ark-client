// Reveal every disclosure containing an unfinished draft before its input is focused.
export function revealDraftInput(invalid: HTMLElement) {
  let revealed = false;
  let ancestor: HTMLElement | null = invalid;
  while (ancestor) {
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      ancestor.open = true;
      revealed = true;
    }
    if (ancestor.hasAttribute('data-draft-collapse')) {
      const header = ancestor.querySelector<HTMLElement>('[role="button"][aria-expanded]');
      if (header?.getAttribute('aria-expanded') === 'false') {
        header.click();
        revealed = true;
      }
    }
    ancestor = ancestor.parentElement;
  }
  return revealed;
}
