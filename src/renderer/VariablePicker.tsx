import { Drawer, Button, Card, Empty, Input, Collapse, Descriptions, Alert } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { composeReference, type ReferenceChoice } from './value-references';
import { VariableNavigationContext } from './variable-navigation';
import './variable-picker.css';
import './editor-workspace-dialog.css';

export default function VariablePicker({
  label,
  choices,
  current,
  choose,
  fixed,
  fixedLabel = '改用固定值',
  close,
}: {
  label: string;
  choices: ReferenceChoice[];
  current?: string;
  choose: (path: string) => void;
  fixed: () => void;
  fixedLabel?: string;
  close: () => void;
}) {
  const navigationContext = useContext(VariableNavigationContext);
  // Keep the opening location when a responsive layout changes underneath the picker.
  const [navigation] = useState(navigationContext);
  const returnLabel = navigation?.source ?? '字段';
  const navigate = (next: () => void) => {
    close();
    requestAnimationFrame(next);
  };
  const source =
    choices.find((choice) => choice.path === current) ??
    choices
      .filter((choice) => current?.startsWith(choice.path + '.'))
      .sort((a, b) => b.path.length - a.path.length)[0];
  const [base, setBase] = useState(source?.path ?? '');
  const [suffix, setSuffix] = useState(
    source && current ? current.slice(source.path.length + 1) : '',
  );
  const [advanced, setAdvanced] = useState(!!suffix);
  const [search, setSearch] = useState('');
  const [failure, setFailure] = useState('');
  const [failureRevision, setFailureRevision] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const sourcesRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const origin = useRef(document.activeElement as HTMLElement | null);
  const searchInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure, failureRevision]);
  const closeRef = useRef(close);
  closeRef.current = close;
  const selected = choices.find((choice) => choice.path === base);
  useLayoutEffect(() => {
    if (!selectionRevision) return;
    const sources = sourcesRef.current;
    const detail = detailRef.current;
    if (
      sources &&
      detail &&
      detail.getBoundingClientRect().top > sources.getBoundingClientRect().top + 1
    ) {
      detail.scrollIntoView({ block: 'start' });
      detailHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [selectionRevision]);
  const filtered = choices.filter((choice) =>
    `${choice.label} ${choice.path} ${choice.group}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  let path = '',
    invalid = '';
  try {
    path = composeReference(choices, base, suffix);
  } catch (error) {
    invalid = error instanceof Error ? error.message : '此引用不可用';
  }
  useEffect(() => {
    const trigger = origin.current;
    return () => {
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    };
  }, []);
  const apply = (operation: () => void) => {
    try {
      operation();
      close();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '字段尚未更新，请重试');
      setFailureRevision((revision) => revision + 1);
    }
  };
  return (
    <Drawer
      open
      panelRef={dialog}
      size="calc(100vw - var(--fa-workspace-navigation-width))"
      closable={false}
      mask={{ closable: false }}
      push={false}
      focusable={{ focusTriggerAfterClose: false, trap: true }}
      rootClassName="editor-workspace-overlay variable-picker-overlay"
      afterOpenChange={(opened) => {
        if (opened) searchInput.current?.focus();
      }}
      className="editor-workspace-dialog variable-picker-dialog"
      aria-labelledby={titleId}
      onClose={() => {
        closeRef.current();
      }}
      onKeyDown={(event) => {
        if ((event.altKey && event.key === 'ArrowLeft') || (event.metaKey && event.key === '[')) {
          if ((event.target as HTMLElement).closest('input,textarea,[contenteditable="true"]'))
            return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <div className="variable-picker-toolbar">
        <Button htmlType="button" onClick={close} aria-label={`返回${returnLabel} · ${label}`}>
          ← 返回{returnLabel}
        </Button>
        <nav aria-label="当前位置">
          {navigation ? (
            <>
              <Button
                type="link"
                htmlType="button"
                onClick={() => navigate(navigation.openLibrary)}
              >
                我的流程
              </Button>
              <span aria-hidden="true">/</span>
              <Button type="link" htmlType="button" onClick={() => navigate(navigation.openFlow)}>
                {navigation.flowName}
              </Button>
              <span aria-hidden="true">/</span>
              <Button type="link" htmlType="button" onClick={close}>
                {navigation.source}
              </Button>
              <span aria-hidden="true">/</span>
            </>
          ) : (
            <>
              <span>{label}</span>
              <span aria-hidden="true">/</span>
            </>
          )}
          <span aria-current="page">选择变量</span>
        </nav>
        {navigation && (
          <Button
            htmlType="button"
            className="variable-picker-browser"
            onClick={() => navigate(navigation.showBrowser)}
          >
            显示网页
          </Button>
        )}
      </div>
      <div className="variable-picker-page">
        <header className="variable-picker-heading">
          <div>
            <h2 id={titleId}>选择变量</h2>
            <p>用于「{label}」· 仅列出当前位置可访问的参数与前序输出。</p>
          </div>
        </header>
        <div className="variable-picker-columns">
          <section ref={sourcesRef} className="variable-picker-sources" aria-label="可用变量来源">
            <Card className="variable-picker-sources-card">
              <div className="variable-picker-search">
                <label htmlFor={titleId + '-search'}>搜索</label>
                <Input
                  id={titleId + '-search'}
                  ref={(instance) => {
                    searchInput.current = instance?.input ?? null;
                  }}
                  aria-label="搜索名称或来源"
                  value={search}
                  placeholder="输入名称、来源或路径"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className="variable-picker-source-list">
                {(['流程参数', '前序步骤', '当前循环'] as const).map((group) => {
                  const items = filtered.filter((choice) => choice.group === group);
                  return items.length ? (
                    <section key={group} aria-label={group}>
                      {items.map((choice) => (
                        <Button
                          key={choice.path}
                          htmlType="button"
                          color={base === choice.path ? 'primary' : 'default'}
                          variant={base === choice.path ? 'filled' : 'outlined'}
                          aria-pressed={base === choice.path}
                          title={choice.path}
                          onClick={() => {
                            setBase(choice.path);
                            setSuffix('');
                            setFailure('');
                            setSelectionRevision((revision) => revision + 1);
                          }}
                        >
                          {group === '前序步骤' ? choice.label : `${group} / ${choice.label}`}
                        </Button>
                      ))}
                    </section>
                  ) : null;
                })}
                {!filtered.length && (
                  <div className="variable-picker-empty">
                    <h3>{choices.length ? '没有匹配的变量' : '当前位置没有可用变量'}</h3>
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={
                        choices.length
                          ? '尝试搜索其他名称或路径。已选来源会保留。'
                          : '先添加流程参数或可访问的前序步骤，也可以返回填写固定值。'
                      }
                    />

                    {search && (
                      <Button
                        htmlType="button"
                        onClick={() => {
                          setSearch('');
                          searchInput.current?.focus();
                        }}
                      >
                        清除搜索
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <p className="variable-picker-note">
                当前循环变量只在循环体内出现。另一条件分支的输出不在候选中。
              </p>
            </Card>
          </section>
          <section ref={detailRef} className="variable-picker-detail" aria-label="引用详情">
            <Card className="variable-picker-detail-card">
              {selected ? (
                <>
                  <h3 ref={detailHeadingRef} tabIndex={-1}>
                    {selected.label}
                  </h3>
                  <Descriptions
                    column={1}
                    layout="vertical"
                    size="small"
                    items={[{ key: 'source', label: '来源', children: selected.hint }]}
                  />
                  <div className="variable-picker-path">
                    <label htmlFor={titleId + '-path'}>引用路径</label>
                    <Input
                      id={titleId + '-path'}
                      readOnly
                      value={suffix ? `${base}.${suffix}` : base}
                    />
                  </div>
                  <p className="variable-picker-note">
                    不使用历史运行值作为默认数据；未知子路径在运行时核验。
                  </p>
                </>
              ) : (
                <div className="variable-picker-empty">
                  <h3>{base || current ? '引用来源不可用' : '选择一个变量来源'}</h3>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      base || current
                        ? '原引用已缺失或不在当前作用域，请重新选择。取消不会修改原字段。'
                        : '在左侧选择参数、前序输出或当前循环变量，核对路径后再应用到字段。'
                    }
                  />

                  {current && <code>{current}</code>}
                </div>
              )}
              {failure && (
                <div ref={failureRef} tabIndex={-1}>
                  <Alert type="error" showIcon title={failure} role="alert" />
                </div>
              )}
              <footer className="variable-picker-actions">
                <Button
                  htmlType="button"
                  type="primary"
                  disabled={!path || undefined}
                  onClick={() => apply(() => choose(path))}
                >
                  使用此变量
                </Button>
                <Button htmlType="button" onClick={() => apply(fixed)}>
                  {fixedLabel}
                </Button>
                <Button htmlType="button" onClick={close} aria-label={'取消选择 · ' + label}>
                  取消
                </Button>
              </footer>
              {selected && (
                <div onKeyDown={activateCollapseWithSpace}>
                  <Collapse
                    size="small"
                    activeKey={advanced ? ['subpath'] : []}
                    onChange={(keys) => setAdvanced(keys.includes('subpath'))}
                    items={[
                      {
                        key: 'subpath',
                        label: '编辑子路径（可选）',
                        forceRender: true,
                        children: (
                          <div className="variable-picker-subpath">
                            <label htmlFor={titleId + '-suffix'}>子路径</label>
                            <Input
                              status={!!invalid ? 'error' : undefined}
                              id={titleId + '-suffix'}
                              value={suffix}
                              disabled={base === 'index' || undefined}
                              placeholder={
                                base === 'index' ? '循环序号没有子字段' : '例如 rows.0.name'
                              }
                              aria-invalid={!!invalid}
                              aria-describedby={invalid ? titleId + '-invalid' : undefined}
                              onChange={(event) => {
                                setSuffix(event.target.value);
                                setFailure('');
                              }}
                            />
                            <p className="variable-picker-note">缺失字段会报错，不会执行表达式。</p>
                          </div>
                        ),
                      },
                    ]}
                  />
                </div>
              )}
              {invalid && selected && (
                <Alert
                  id={titleId + '-invalid'}
                  type="error"
                  showIcon
                  title={invalid}
                  role="alert"
                />
              )}
            </Card>
          </section>
        </div>
      </div>
    </Drawer>
  );
}
