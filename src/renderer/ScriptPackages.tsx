import { Alert, Button, Card, Collapse, Descriptions, Modal, Tag } from 'antd';
import './antd-layout.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Bindings, Step } from '../shared/types';
import './script-packages.css';
import { activateCollapseWithSpace } from './collapseKeyboard';

type Package = { name: string; version: string; path: string };
type Props = {
  flowId: string;
  node: Extract<Step, { type: 'script' }>;
  bindings: Bindings;
  bind: (info: Package) => void | boolean;
  remove: (name: string) => void | boolean;
  guard?: () => boolean;
};
type Check = { signature: string; error?: string };
const identity = (props: Props) => `${props.flowId}:${props.node.id}`;
const signature = (props: Props, name: string) =>
  JSON.stringify([
    identity(props),
    props.node.dependencies.find((dep) => dep.name === name),
    props.bindings.scriptPackages?.[name],
  ]);
const fail = (reason: unknown) =>
  (reason instanceof Error ? reason.message : '依赖操作未完成，请重新核对').replace(
    /^Error invoking remote method 'flowark:request': (?:Error: )?/,
    '',
  );
export default function ScriptPackages(props: Props) {
  const [failure, setFailure] = useState<{ message: string; name?: string }>();
  const error = failure?.message ?? '';
  const reportError = (reason: unknown, name?: string) =>
    setFailure({ message: fail(reason), name });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [candidate, setCandidate] = useState<{ info: Package; source: string; before: string }>();
  const locked = useRef(false);
  const latest = useRef(props);
  latest.current = props;
  const alive = useRef(true);
  const root = useRef<HTMLElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const review = useRef<HTMLHeadingElement>(null);
  const errorElement = useRef<HTMLDivElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const restore = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setFailure(undefined);
    setNotice('');
    setChecks({});
    setCandidate(undefined);
  }, [props.flowId, props.node.id]);
  useEffect(() => {
    if (!candidate && restore.current) {
      restore.current = false;
      if (origin.current?.isConnected) origin.current.focus();
      else addButton.current?.focus();
    }
  }, [candidate]);
  useLayoutEffect(() => {
    const target = errorElement.current;
    if (!failure || !target?.getClientRects().length) return;
    target.focus();
    target.scrollIntoView({ block: 'nearest' });
  }, [candidate, failure]);
  const cancel = () => {
    restore.current = true;
    setCandidate(undefined);
    setFailure(undefined);
  };
  const refocus = (element: HTMLElement | null, source: string) =>
    requestAnimationFrame(() => {
      if (
        alive.current &&
        source === identity(latest.current) &&
        element?.isConnected &&
        (!document.activeElement || document.activeElement === document.body)
      )
        element.focus();
    });
  const choose = async (name?: string) => {
    if (locked.current || props.guard?.() === false) return;
    const source = identity(props);
    const start = name
      ? signature(props, name)
      : JSON.stringify([props.node.dependencies, props.bindings.scriptPackages]);
    const current = () =>
      alive.current &&
      source === identity(latest.current) &&
      start ===
        (name
          ? signature(latest.current, name)
          : JSON.stringify([
              latest.current.node.dependencies,
              latest.current.bindings.scriptPackages,
            ]));
    origin.current = document.activeElement as HTMLElement | null;
    const trigger = origin.current;
    let opened = false;
    locked.current = true;
    setBusy(name ?? 'add');
    setFailure(undefined);
    setNotice('');
    try {
      const path = await window.flowark.request('file.choose', { kind: 'directory' });
      if (!current()) return;
      if (!path) {
        setNotice('已取消选择，原有依赖保持不变。');
        return;
      }
      const info: Package = await window.flowark.request('script.package.inspect', { path });
      if (!current()) return;
      if (name && info.name !== name)
        throw new Error(`所选包为 ${info.name}，请为 ${name} 选择同名包目录`);
      opened = true;
      setCandidate({ info, source, before: signature(latest.current, info.name) });
    } catch (reason) {
      if (current()) reportError(reason, name);
    } finally {
      locked.current = false;
      if (alive.current) setBusy('');
      if (!opened) refocus(trigger, source);
    }
  };
  const inspect = async (name?: string) => {
    if (locked.current || props.guard?.() === false) return;
    const trigger = document.activeElement as HTMLElement | null;
    const source = identity(props);
    const names = name
      ? [name]
      : props.node.dependencies
          .filter((dep) => props.bindings.scriptPackages?.[dep.name]?.path)
          .map((dep) => dep.name);
    if (!names.length) return;
    const before = JSON.stringify([source, props.node.dependencies, props.bindings.scriptPackages]);
    const current = () =>
      alive.current &&
      before ===
        JSON.stringify([
          identity(latest.current),
          latest.current.node.dependencies,
          latest.current.bindings.scriptPackages,
        ]);
    let passed = 0;
    let failed = 0;
    locked.current = true;
    setFailure(undefined);
    setNotice('');
    try {
      for (const item of names) {
        if (!current()) return;
        const expected = props.node.dependencies.find((dep) => dep.name === item);
        const binding = props.bindings.scriptPackages?.[item];
        if (!binding?.path || !expected) continue;
        const itemSignature = signature(props, item);
        setBusy(item);
        let error: string | undefined;
        try {
          const info: Package = await window.flowark.request('script.package.inspect', {
            path: binding.path,
          });
          if (!current()) return;
          if (
            info.name !== item ||
            info.version !== expected.version ||
            binding.version !== expected.version
          )
            throw new Error(
              `要求 ${item}@${expected.version}；目录实际为 ${info.name}@${info.version}，请重新绑定。`,
            );
          passed++;
        } catch (reason) {
          if (!current()) return;
          error = fail(reason);
          failed++;
        }
        setChecks((values) => ({ ...values, [item]: { signature: itemSignature, error } }));
      }
      if (current()) {
        const missing = props.node.dependencies.length - names.length;
        setNotice(
          name
            ? `目录核对${failed ? '失败，请查看该依赖的错误说明' : '完成，包名与版本一致'}。`
            : `目录核对完成：${passed} 个通过，${failed} 个失败${missing ? `，${missing} 个未绑定目录` : ''}。完整编译与运行前检查仍需通过。`,
        );
      }
    } finally {
      locked.current = false;
      if (alive.current) setBusy('');
      refocus(trigger, source);
    }
  };
  const apply = () => {
    if (!candidate) return;
    try {
      const { info, source, before } = candidate;
      if (source !== identity(latest.current) || before !== signature(latest.current, info.name))
        throw new Error('依赖已变化，请取消后重新选择目录。');
      if (latest.current.bind(info) === false)
        throw new Error('当前步骤有未完成的输入，请取消并修正后再绑定。');
      setNotice(`已将 ${info.name}@${info.version} 应用到当前草稿，保存流程后生效。`);
      restore.current = true;
      setCandidate(undefined);
      setFailure(undefined);
      setChecks((values) => {
        const next = { ...values };
        delete next[info.name];
        return next;
      });
    } catch (reason) {
      reportError(reason);
    }
  };
  const remove = (name: string) => {
    if (locked.current || props.guard?.() === false) return;
    setFailure(undefined);
    setNotice('');
    const buttons = Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>('[data-dependency-remove]') ?? [],
    );
    const index = buttons.findIndex((button) => button.dataset.dependencyRemove === name);
    const next = buttons[index + 1] ?? buttons[index - 1];
    try {
      if (props.remove(name) === false) throw new Error('当前步骤有未完成的输入，依赖未移除。');
      setNotice(`已从当前步骤移除 ${name}；未删除本机包目录。保存流程后生效。`);
      requestAnimationFrame(() => {
        if (next?.isConnected) next.focus();
        else addButton.current?.focus();
      });
    } catch (reason) {
      reportError(reason, name);
    }
  };
  const old = candidate && props.node.dependencies.find((dep) => dep.name === candidate.info.name);
  const previous = candidate && props.bindings.scriptPackages?.[candidate.info.name];
  return (
    <section ref={root} className="script-packages" aria-label="脚本本地依赖">
      <header className="script-packages-heading">
        <h3>本地依赖</h3>
        <span>{props.node.dependencies.length} 个</span>
      </header>
      <p className="note">选择已安装包的目录，使用精确版本。运行时不自动安装依赖。</p>
      {props.node.dependencies.length > 1 && (
        <Button
          disabled={
            !!busy ||
            !props.node.dependencies.some(
              (dep) => props.bindings.scriptPackages?.[dep.name]?.path,
            ) ||
            undefined
          }
          onClick={() => void inspect()}
        >
          核对全部已绑定目录
        </Button>
      )}
      {!props.node.dependencies.length && (
        <Alert type="info" showIcon title="当前步骤未声明第三方依赖。需要时绑定已有包目录。" />
      )}
      {props.node.dependencies.map((dep) => {
        const binding = props.bindings.scriptPackages?.[dep.name];
        const check =
          checks[dep.name]?.signature === signature(props, dep.name) ? checks[dep.name] : undefined;
        const missing = !binding?.path,
          mismatch = !!binding && binding.version !== dep.version;
        const warning = missing || mismatch || !!check?.error;
        return (
          <Card
            size="small"
            className="script-package-card"
            key={dep.name}
            role="group"
            aria-label={`${dep.name} 依赖`}
          >
            <h4>{dep.name}</h4>
            <p className="script-package-version">
              要求版本 <strong>{dep.version}</strong>
            </p>
            <Tag
              className="script-package-state"
              color={
                busy === dep.name
                  ? 'processing'
                  : warning
                    ? 'warning'
                    : check
                      ? 'success'
                      : 'default'
              }
            >
              {busy === dep.name
                ? '正在读取包信息…'
                : missing
                  ? '尚未绑定目录'
                  : mismatch
                    ? '绑定版本不一致'
                    : check?.error
                      ? '当前目录核对失败'
                      : check
                        ? '名称与版本已核对'
                        : '已绑定 · 本次尚未核对'}
            </Tag>
            {binding?.path && (
              <div className="script-package-directory" onKeyDown={activateCollapseWithSpace}>
                <Collapse
                  size="small"
                  items={[
                    {
                      key: 'directory',
                      label: '查看本机目录',
                      forceRender: true,
                      children: (
                        <Descriptions
                          size="small"
                          column={1}
                          layout="vertical"
                          items={[
                            {
                              key: 'path',
                              label: '本机目录',
                              children: <span className="path-text">{binding.path}</span>,
                            },
                            { key: 'version', label: '绑定版本', children: binding.version },
                          ]}
                        />
                      ),
                    },
                  ]}
                />
              </div>
            )}
            {check?.error && <Alert type="error" showIcon title={check.error} />}
            {error && !candidate && failure?.name === dep.name && (
              <div ref={errorElement} tabIndex={-1}>
                <Alert type="error" showIcon title={error} />
              </div>
            )}
            {check && !check.error && (
              <p className="note">仅核对目录的包名与版本；完整依赖编译与运行前检查仍需通过。</p>
            )}
            <div className="script-package-actions">
              <Button disabled={!!busy || undefined} onClick={() => void choose(dep.name)}>
                {missing ? '选择包目录' : '重新选择目录'}
              </Button>
              <Button
                disabled={!!busy || missing || undefined}
                onClick={() => void inspect(dep.name)}
              >
                核对当前目录
              </Button>
              <Button
                danger
                disabled={!!busy || undefined}
                data-dependency-remove={dep.name}
                aria-label={`移除依赖 ${dep.name}`}
                onClick={() => remove(dep.name)}
              >
                移除依赖
              </Button>
            </div>
          </Card>
        );
      })}
      <Button
        ref={addButton}
        onClick={() => void choose()}
        loading={busy === 'add'}
        disabled={!!busy || undefined}
      >
        {busy === 'add' ? '读取包信息…' : '绑定本地包'}
      </Button>
      {notice && <Alert type="info" showIcon role="status" title={notice} />}
      {error && !candidate && !failure?.name && (
        <div ref={errorElement} tabIndex={-1}>
          <Alert type="error" showIcon title={error} />
        </div>
      )}
      {candidate && (
        <Modal
          open
          width={640}
          centered
          closable={false}
          mask={{ closable: false }}
          footer={null}
          className="flowark-content-modal script-package-dialog"
          aria-label="核对本地依赖变更"
          focusable={{ focusTriggerAfterClose: false }}
          onCancel={cancel}
          afterOpenChange={(open) => {
            if (open) (error ? errorElement.current : review.current)?.focus();
          }}
        >
          <h2 ref={review} tabIndex={-1}>
            核对本地依赖变更
          </h2>
          <p>只更新当前草稿；不会安装包或运行脚本。</p>
          <h3>{candidate.info.name}</h3>
          <Descriptions
            size="small"
            column={1}
            layout="vertical"
            className="script-package-review"
            items={[
              { key: 'current', label: '当前步骤版本', children: old?.version ?? '未声明' },
              { key: 'next', label: '所选目录版本', children: candidate.info.version },
              ...(previous
                ? [
                    {
                      key: 'previous-path',
                      label: '当前绑定目录',
                      children: <span className="path-text">{previous.path}</span>,
                    },
                  ]
                : []),
              {
                key: 'path',
                label: '所选本机目录',
                children: <span className="path-text">{candidate.info.path}</span>,
              },
            ]}
          />
          {old && old.version !== candidate.info.version && (
            <Alert
              type="warning"
              showIcon
              title={`应用后将把本步骤的依赖版本改为 ${candidate.info.version}。其他步骤若声明不同版本，会拒绝应用。`}
            />
          )}
          <p>
            目录绑定由同一流程的脚本步骤共享。保存后供新的运行使用，已有运行与计划的固定内容保持原样。
          </p>
          {error && (
            <div ref={errorElement} tabIndex={-1}>
              <Alert type="error" showIcon title={error} />
            </div>
          )}
          <footer className="script-package-actions">
            <Button onClick={cancel}>取消</Button>
            <Button type="primary" onClick={apply}>
              应用到草稿
            </Button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
