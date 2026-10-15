import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { Alert, Button, Card, ConfigProvider, Checkbox } from 'antd';
import {
  assertDataContext,
  assertDataState,
  type DataContext,
  type DataState,
  type DataEdit,
} from '../shared/template-data';
import type { AuthorCheckout } from '../shared/template-author';
import type { TemplateNavigation } from './TemplateInstancePage';
import { Field, type ConfigurationFieldDraft } from './TemplateConfiguration';
import { LiteralValue } from './ValueField';
import EditorLeaveDialog from './EditorLeaveDialog';
import { usePageBack } from './use-page-back';
import './template-data.css';
type View = { checkout: AuthorCheckout; context: DataContext; state: DataState };
export default function DebugContextPage({
  active,
  request,
  navigation,
  back,
}: {
  active: boolean;
  request?: { flowId: string; nonce: string };
  navigation: MutableRefObject<TemplateNavigation | undefined>;
  back: () => void;
}) {
  const [base, setBase] = useState<View>(),
    [remote, setRemote] = useState<View>(),
    [configuration, setConfiguration] = useState<any>(),
    [state, setState] = useState<any>(),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [touched, setTouched] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [leave, setLeave] = useState<{ next: () => void; label: string }>();
  const form = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    locked = useRef(false),
    generation = useRef(0),
    fieldDrafts = useRef<{
      configuration: ConfigurationFieldDraft;
      state: ConfigurationFieldDraft;
    }>({ configuration: {}, state: {} }),
    pending = useRef<{ key: string; edit: DataEdit } | undefined>(undefined),
    focus = useRef<HTMLElement | null>(null);
  const dirty =
    touched ||
    (!!base &&
      (JSON.stringify(configuration) !== JSON.stringify(base.context.configuration) ||
        JSON.stringify(state) !== JSON.stringify(base.state.value)));
  const read = async () => {
    if (!request) throw Error('制作副本尚未选择');
    const v = (await window.flowark.request('context.debug.get', {
      flowId: request.flowId,
    })) as View;
    assertDataContext(v.context);
    assertDataState(v.state);
    return v;
  };
  const accept = (v: View) => {
    setBase(v);
    setRemote(undefined);
    setConfiguration(structuredClone(v.context.configuration));
    setState(structuredClone(v.state.value));
    setTouched(false);
    setReviewed(false);
    pending.current = undefined;
    fieldDrafts.current = { configuration: {}, state: {} };
  };
  useEffect(() => {
    if (!active || !request) return;
    const visit = ++generation.current;
    setBase(undefined);
    setError('');
    setNotice('');
    setRemote(undefined);
    setTouched(false);
    void read()
      .then((v) => {
        if (generation.current === visit) {
          accept(v);
          requestAnimationFrame(() => heading.current?.focus());
        }
      })
      .catch((e) => {
        if (generation.current === visit) setError(e.message ?? '调试上下文读取失败');
      });
    return () => {
      generation.current++;
    };
  }, [request?.nonce]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (active && dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active, dirty]);
  const navigate = (next: () => void, label = '流程编排') => {
    if (locked.current) return;
    if (dirty) {
      focus.current = document.activeElement as HTMLElement;
      setLeave({ next, label });
    } else next();
  };
  useLayoutEffect(() => {
    navigation.current = navigate;
    return () => {
      if (navigation.current === navigate) navigation.current = undefined;
    };
  });
  usePageBack(() => navigate(back), active);
  const work = async (action: () => Promise<void>) => {
    if (locked.current) throw Error('正在处理，请稍候');
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e: any) {
      setError(e.message ?? '处理未完成，输入已保留');
      throw e;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const save = () =>
    work(async () => {
      if (!base) throw Error('调试上下文尚未读取');
      if (remote) throw Error('请先对照较新修订并明确选择基线');
      const invalid = form.current?.querySelector<HTMLElement>(
        '[data-value-invalid]:not([data-value-invalid="false"])',
      );
      if (invalid) {
        invalid.focus();
        invalid.scrollIntoView({ block: 'nearest' });
        throw Error('请先修正未完成的字段值，当前输入已保留');
      }
      const content = {
          version: 1 as const,
          checkoutId: base.checkout.id,
          expectedConfigurationRevision: base.context.configurationRevision,
          expectedStateRevision: base.state.revision,
          configuration,
          state,
        },
        key = JSON.stringify(content);
      if (pending.current?.key !== key)
        pending.current = { key, edit: { ...content, requestId: crypto.randomUUID() } };
      const result = await window.flowark.request('context.debug.save', {
        edit: pending.current.edit,
      });
      assertDataContext(result.context);
      assertDataState(result.state);
      accept({ ...base, context: result.context, state: result.state });
      setNotice('调试配置与状态已保存；未开始运行。');
    });
  const compare = () =>
    work(async () => {
      const v = await read();
      if (v.context.id !== base?.context.id || v.context.schemaSha256 !== base.context.schemaSha256)
        throw Error('上下文来源已变化，请返回制作草稿核对');
      setRemote(v);
      setReviewed(false);
      setNotice('当前输入保留。请对照两端完整内容，再选择较新修订作为保存基线。');
    });
  const fields = (
    schema: any,
    value: any,
    change: (v: any) => void,
    draft: ConfigurationFieldDraft,
    label: string,
  ) =>
    (schema.type || schema.properties || schema.enum || schema.oneOf) &&
    !schema.$ref &&
    !schema.allOf &&
    !schema.anyOf ? (
      <Field
        schema={schema.properties && !schema.type ? { ...schema, type: 'object' } : schema}
        value={value}
        change={change}
        required
        draft={draft}
        label={label}
      />
    ) : (
      <LiteralValue label={label} value={value} change={change} draft={draft} />
    );
  return (
    <div hidden={!active} className="context-debug-root">
      <header className="topbar">
        <nav aria-label="当前位置">模板制作 / 编排副本 / 私有调试值</nav>
      </header>
      <section className="context-debug-page" aria-label="调试配置与状态">
        <h1 ref={heading} tabIndex={-1}>
          调试配置与状态
        </h1>
        <p>只配置当前副本，使用创建副本时固定的字段定义；保存不执行，私有调试值不进入ZIP。</p>
        {error && (
          <Alert
            type="error"
            showIcon
            title={error}
            action={
              !base ? (
                <Button
                  disabled={busy}
                  onClick={() => void work(async () => accept(await read())).catch(() => {})}
                >
                  重新读取
                </Button>
              ) : undefined
            }
          />
        )}
        {notice && <Alert type="info" showIcon title={notice} />}
        {base && (
          <ConfigProvider componentDisabled={busy || !!leave}>
            <div
              ref={form}
              onInputCapture={() => setTouched(true)}
              className="context-debug-columns"
            >
              <Card title="本副本共享配置">
                <p>配置修订：{base.context.configurationRevision}</p>
                {fields(
                  base.context.configurationSchema,
                  configuration,
                  setConfiguration,
                  fieldDrafts.current.configuration,
                  '共享配置',
                )}
                <p>初始值仅来自作者公开默认值；此处改动为私有调试值。</p>
              </Card>
              <Card title="本副本状态">
                <p>状态修订：{base.state.revision}</p>
                {fields(
                  base.context.stateSchema,
                  state,
                  setState,
                  fieldDrafts.current.state,
                  '状态',
                )}
                <p>保存同时核对配置与状态修订。正式实例与其他副本保持独立。</p>
              </Card>
            </div>
          </ConfigProvider>
        )}
        {remote && (
          <Card title="较新修订对照（当前输入保留）">
            <div className="context-debug-columns">
              <section>
                <h3>配置修订 {remote.context.configurationRevision}</h3>
                <pre className="context-json" tabIndex={0}>
                  {JSON.stringify(remote.context.configuration, null, 2)}
                </pre>
              </section>
              <section>
                <h3>状态修订 {remote.state.revision}</h3>
                <pre className="context-json" tabIndex={0}>
                  {JSON.stringify(remote.state.value, null, 2)}
                </pre>
              </section>
            </div>
            <Checkbox checked={reviewed} onChange={(e) => setReviewed(e.target.checked)}>
              已对照较新内容；下一次保存将用当前输入替换完整配置与状态
            </Checkbox>
            <Button
              disabled={!reviewed || busy}
              onClick={() => {
                setBase(remote);
                setRemote(undefined);
                pending.current = undefined;
                setTouched(true);
                setNotice('已采用较新修订作为基线，当前输入保留；尚未保存。');
              }}
            >
              以较新修订为基线，保留输入
            </Button>
          </Card>
        )}
        <div className="author-actions">
          <Button
            type="primary"
            loading={busy}
            disabled={!base || busy || !!leave}
            onClick={() => void save().catch(() => {})}
          >
            保存调试值
          </Button>
          <Button
            disabled={!base || busy || !!leave}
            onClick={() => void compare().catch(() => {})}
          >
            读取较新修订对照
          </Button>
          <Button disabled={busy || !!leave} onClick={() => navigate(back)}>
            回到编排
          </Button>
        </div>
      </section>
      {active && leave && (
        <EditorLeaveDialog
          name="调试配置与状态"
          destination={leave.label}
          draftLabel="私有调试值"
          save={async () => {
            await save();
            setLeave(undefined);
            leave.next();
          }}
          discard={() => {
            setLeave(undefined);
            setTouched(false);
            leave.next();
          }}
          stay={() => {
            setLeave(undefined);
            requestAnimationFrame(() => {
              if (focus.current?.isConnected) focus.current.focus();
            });
          }}
        />
      )}
    </div>
  );
}
