import { Button, Input } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';
import { stepTitle, type OutlineEntry } from './flow-outline';

export default function OutlineStepSearch({
  query,
  change,
  matches,
  choose,
}: {
  query: string;
  change: (query: string) => void;
  matches: OutlineEntry[];
  choose: (id: string) => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(-1);
  const open = expanded && !!query.trim();
  const selected = active >= 0 && active < matches.length ? active : -1;
  const identity = matches.map((item) => item.step.id).join('\n');
  useEffect(() => setActive(-1), [query, identity]);
  useEffect(() => {
    if (open && selected >= 0)
      results.current?.children[selected]?.scrollIntoView({ block: 'nearest' });
  }, [open, selected]);
  const accept = (entry: OutlineEntry) => {
    setExpanded(false);
    setActive(-1);
    choose(entry.step.id);
  };
  return (
    <div
      className="outline-search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
    >
      <label htmlFor={id}>搜索步骤</label>
      <div className="outline-search-field">
        <Input
          ref={(instance) => {
            input.current = instance?.input ?? null;
          }}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? `${id}-results` : undefined}
          aria-activedescendant={open && selected >= 0 ? `${id}-option-${selected}` : undefined}
          value={query}
          placeholder="名称、步骤编号或动作类型"
          autoComplete="off"
          onFocus={() => setExpanded(true)}
          onChange={(event) => {
            change(event.target.value);
            setExpanded(true);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              setExpanded(false);
              setActive(-1);
            }
            if (['ArrowDown', 'ArrowUp'].includes(event.key) && matches.length) {
              event.preventDefault();
              setExpanded(true);
              setActive(
                event.key === 'ArrowDown'
                  ? !open || selected < 0
                    ? 0
                    : (selected + 1) % matches.length
                  : !open || selected < 0
                    ? matches.length - 1
                    : (selected - 1 + matches.length) % matches.length,
              );
            }
            if (event.key === 'Enter' && open && matches.length) {
              event.preventDefault();
              accept(matches[selected < 0 ? 0 : selected]);
            }
          }}
        />
        {query && (
          <Button
            htmlType="button"
            className="outline-search-clear"
            aria-label="清除步骤搜索"
            onClick={() => {
              change('');
              setActive(-1);
              input.current?.focus();
            }}
          >
            ×
          </Button>
        )}
      </div>
      {query.trim() && <span role="status">找到 {matches.length} 个步骤</span>}
      {open && (
        <div className="outline-search-popup">
          <div
            className="outline-search-results"
            id={`${id}-results`}
            role="listbox"
            aria-label="步骤搜索结果"
            ref={results}
          >
            {matches.map((item, index) => (
              <div
                id={`${id}-option-${index}`}
                key={item.step.id}
                role="option"
                aria-selected={selected === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => accept(item)}
              >
                {item.ordinal} · {stepTitle(item.step)}
                <small>{item.step.id}</small>
              </div>
            ))}
          </div>
          {!matches.length && <p>没有匹配的步骤，试试名称、编号或动作类型。</p>}
        </div>
      )}
    </div>
  );
}
