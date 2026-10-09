import { Clock } from 'lucide-react';

const workflow = new URL('./assets/navigation/workflow.svg?no-inline', import.meta.url).href;
const workflowActive = new URL('./assets/navigation/workflow-active.svg?no-inline', import.meta.url)
  .href;
const layout = new URL('./assets/navigation/layout.svg?no-inline', import.meta.url).href;
const layoutActive = new URL('./assets/navigation/layout-active.svg?no-inline', import.meta.url)
  .href;
const settings = new URL('./assets/navigation/settings.svg?no-inline', import.meta.url).href;
const history = new URL('./assets/navigation/history.svg?no-inline', import.meta.url).href;
const bell = new URL('./assets/navigation/bell.svg?no-inline', import.meta.url).href;

export type NavigationItem =
  | 'tasks'
  | 'flows'
  | 'tools'
  | 'templates'
  | 'runs'
  | 'schedules'
  | 'inbox'
  | 'settings';

export default function NavigationIcon({
  item,
  active = false,
}: {
  item: NavigationItem;
  active?: boolean;
}) {
  if (item === 'schedules') return <Clock size={20} strokeWidth={1.6} aria-hidden="true" />;
  const source =
    item === 'tasks'
      ? active
        ? workflowActive
        : workflow
      : item === 'flows' || item === 'templates'
        ? active
          ? layoutActive
          : layout
        : item === 'runs'
          ? history
          : item === 'inbox'
            ? bell
            : settings;
  const tint = active && ['runs', 'inbox', 'tools', 'settings'].includes(item);
  return (
    <img
      className={`navigation-icon${tint ? ' navigation-icon-inverse' : ''}`}
      src={source}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
