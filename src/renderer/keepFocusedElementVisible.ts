export function keepFocusedElementVisible(target: HTMLElement) {
  const main = target.closest('main');
  const ensureVisible = () => {
    if (!main || !target.isConnected || document.activeElement !== target) return;
    const bounds = target.getBoundingClientRect();
    const visible = main.getBoundingClientRect();
    const style = getComputedStyle(target);
    const margin = (value: string) => Number.parseFloat(value) || 0;
    if (
      bounds.top - margin(style.scrollMarginTop) < visible.top ||
      bounds.bottom + margin(style.scrollMarginBottom) > visible.bottom ||
      bounds.left - margin(style.scrollMarginLeft) < visible.left ||
      bounds.right + margin(style.scrollMarginRight) > visible.right
    )
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  ensureVisible();
  // Parent pages may restore their saved scroll in the same animation frame.
  const frame = requestAnimationFrame(ensureVisible);
  const observer = new ResizeObserver(ensureVisible);
  observer.observe(target);
  if (main) observer.observe(main);
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
