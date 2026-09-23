import { useId, useRef, useState } from 'react';
import type { ToolDefinition } from '../shared/tool-connections';
import { ToolDefinitionDetails } from './ToolCapabilityReview';

export default function TaskToolPicker({
  tools,
  names,
  disabled,
  change,
}: {
  tools: ToolDefinition[];
  names: string[];
  disabled: boolean;
  change: (names: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const needle = query.trim().toLocaleLowerCase();
  const shown = tools.filter(
    (tool) =>
      (!onlySelected || names.includes(tool.name)) &&
      [tool.name, tool.title, tool.description].some((text) =>
        text?.toLocaleLowerCase().includes(needle),
      ),
  );
  const clear = () => {
    setQuery('');
    setOnlySelected(false);
    input.current?.focus();
  };
  return (
    <section className="task-tool-picker" aria-label="本次工具选择">
      <label htmlFor={`${id}-search`}>查找本次工具</label>
      <input
        id={`${id}-search`}
        ref={input}
        type="search"
        value={query}
        placeholder="工具名称、原名或用途"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="ai-task-actions" role="group" aria-label="工具选择筛选">
        <button aria-pressed={!onlySelected} onClick={() => setOnlySelected(false)}>
          全部工具 · {tools.length}
        </button>
        <button aria-pressed={onlySelected} onClick={() => setOnlySelected(true)}>
          已选工具 · {names.length}
        </button>
        {!!(query || onlySelected) && <button onClick={clear}>清除工具筛选</button>}
      </div>
      <p role="status">
        显示 {shown.length} / {tools.length} 项；已选 {names.length} / 30 项。筛选不会取消已选工具。
      </p>
      {names.length >= 30 && (
        <p className="ai-task-note">已达到 30 项上限。取消已选工具后，可以选择其他工具。</p>
      )}
      <fieldset className="task-tools-options">
        <legend>选择本次需要的工具</legend>
        {shown.map((tool) => (
          <div className="task-tool-option" key={tool.name}>
            <label className="ai-task-checkbox">
              <input
                type="checkbox"
                checked={names.includes(tool.name)}
                disabled={disabled || (!names.includes(tool.name) && names.length >= 30)}
                onChange={(event) =>
                  change(
                    event.target.checked
                      ? [...names, tool.name]
                      : names.filter((name) => name !== tool.name),
                  )
                }
              />
              <span>
                <strong>{tool.title || tool.name}</strong>
                <small>{tool.name}</small>
                <p>{tool.description || '尚无用途说明'}</p>
              </span>
            </label>
            <button
              aria-expanded={expanded === tool.name}
              onClick={() => setExpanded(expanded === tool.name ? undefined : tool.name)}
            >
              查看 {tool.title || tool.name} 的参数与声明
            </button>
            {expanded === tool.name && (
              <div className="task-tool-definition">
                <ToolDefinitionDetails tool={tool} />
                <p>以上是服务声明，不表示已授予任务权限。查看不会调用工具。</p>
              </div>
            )}
          </div>
        ))}
      </fieldset>
      {!shown.length && (
        <div className="task-target-empty">
          <p>
            {!tools.length
              ? '该连接没有可选择的工具。'
              : onlySelected && !names.length
                ? '还没有勾选工具，可返回全部工具选择。'
                : '没有符合当前筛选的工具。'}
          </p>
          {!!tools.length && <button onClick={clear}>查看全部工具</button>}
        </div>
      )}
    </section>
  );
}
