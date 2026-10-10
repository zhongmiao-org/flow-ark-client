import { Badge, Button, Card, Tag } from 'antd';
import { elementPickerColors } from './theme';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Crosshair, Check, X } from 'lucide-react';
import type { ElementTarget, PickerState } from '../shared/element-picker';
import './element-picker.css';
import { useBrowserFocus } from './BrowserFocusContext';
import type { FocusedTarget } from '../shared/browser-observation';
const api = (method: string, args: any = {}) => window.flowark.request(method, args);
export type ElementPickerControls = { pick: () => void; focus: () => void };
export default function ElementPicker({
  selector,
  framePath,
  onSelect,
  onInspect,
  onStart,
  onAdjust,
  blockingRunId,
  onViewRun,
  confirmBeforeApply = false,
  allowInspect = true,
  disabled = false,
  active = true,
  pickLabel,
  controls,
  purpose = 'step',
  onCandidateChange,
  sourceKey,
}: {
  selector: string;
  framePath: string[];
  onSelect: (target: ElementTarget, requestId: string) => void | Promise<void>;
  purpose?: 'step' | 'task';
  onCandidateChange?: (target: ElementTarget | undefined) => void;
  sourceKey?: string;
  onInspect: (target: ElementTarget) => void;
  onStart?: () => void;
  onAdjust?: () => void;
  blockingRunId?: string;
  onViewRun?: (detail: any, trigger?: HTMLElement) => void;
  confirmBeforeApply?: boolean;
  allowInspect?: boolean;
  disabled?: boolean;
  active?: boolean;
  pickLabel?: string;
  controls?: Ref<ElementPickerControls>;
}) {
  const region = useRef<HTMLDivElement>(null);
  const browserFocus = useBrowserFocus();
  const closeFocus = browserFocus?.close;
  const canApply = useRef(false);
  canApply.current = active && !disabled;
  const [focusing, setFocusing] = useState(false);
  const [picking, setPicking] = useState(false),
    [validating, setValidating] = useState(false);
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [verified, setVerified] = useState<ElementTarget>();
  type Candidate = { target: ElementTarget; requestId: string; focused?: boolean };
  const [candidate, setCandidate] = useState<Candidate>();
  useEffect(() => {
    onCandidateChange?.(candidate?.target);
    return () => onCandidateChange?.(undefined);
  }, [candidate?.target, onCandidateChange]);
  const pending = useRef<Candidate | undefined>(undefined);
  const [viewingRun, setViewingRun] = useState(false);
  const [runError, setRunError] = useState('');
  const runRequest = useRef(0);
  const viewRunButton = useRef<HTMLButtonElement>(null);
  const viewRun = useRef(onViewRun);
  viewRun.current = onViewRun;
  useEffect(() => {
    runRequest.current++;
    setViewingRun(false);
    setRunError('');
    return () => {
      runRequest.current++;
    };
  }, [blockingRunId, active, selector, JSON.stringify(framePath)]);
  const [applying, setApplying] = useState(false);
  const applyButton = useRef<HTMLButtonElement>(null);
  const pickButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (candidate) applyButton.current?.focus();
  }, [candidate]);
  const clearCandidate = () => {
    const previous = pending.current;
    pending.current = undefined;
    setCandidate(undefined);
    if (previous) closeFocus?.(previous.requestId);
    if (previous)
      void api('browser.embedded.pick.cancel', { requestId: previous.requestId }).catch(() => {});
  };
  const request = useRef(''),
    version = useRef(0),
    alive = useRef(true);
  const select = useRef(onSelect),
    inspect = useRef(onInspect);
  const previousSource = useRef(sourceKey);
  select.current = onSelect;
  inspect.current = onInspect;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      version.current++;
      const candidateId = pending.current?.requestId;
      pending.current = undefined;
      if (candidateId) closeFocus?.(candidateId);
      if (candidateId)
        void api('browser.embedded.pick.cancel', { requestId: candidateId }).catch(() => {});
      const id = request.current;
      request.current = '';
      if (id) void api('browser.embedded.pick.cancel', { requestId: id }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    const sourceChanged = previousSource.current !== sourceKey;
    previousSource.current = sourceKey;
    setMessage(
      sourceChanged && (pending.current || request.current)
        ? '网页已变化，已取消待确认目标，请重新选取'
        : '',
    );
    setError('');
    setVerified(undefined);
    setValidating(false);
    setApplying(false);
    setFocusing(false);
    clearCandidate();
    version.current++;
    const id = request.current;
    if (id) {
      request.current = '';
      setPicking(false);
      void api('browser.embedded.pick.cancel', { requestId: id }).catch(() => {});
    }
  }, [selector, JSON.stringify(framePath), active, sourceKey]);
  useEffect(() => {
    // Hiding/minimizing the native view cancels an unconfirmed pick. A focused
    // candidate has a separate captured identity and is rechecked by its view.
    if (!active || !candidate || candidate.focused || applying || focusing) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const current = version.current;
      try {
        const state: PickerState = await api('browser.embedded.pick.status', {
          requestId: candidate.requestId,
        });
        if (!live || current !== version.current || pending.current !== candidate) return;
        if (state.phase === 'cancelled' || state.phase === 'error') {
          version.current++;
          clearCandidate();
          setError(state.error || '网页选取已结束，请展开网页后重新选取');
          return;
        }
      } catch {
        // A transient status failure is not evidence that the pick was cancelled.
      }
      if (live) timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, candidate, applying, focusing]);
  const open = async () => {
    window.dispatchEvent(new Event('flowark:open-browser'));
    await api('browser.embedded.enable');
    await api('browser.embedded.visibility', { visible: true });
  };
  const cancel = async () => {
    const requestId = request.current;
    request.current = '';
    setPicking(false);
    setMessage('已取消选取');
    if (requestId) await api('browser.embedded.pick.cancel', { requestId }).catch(() => {});
  };
  const pick = async () => {
    if (disabled || !active || picking || validating || applying || focusing || viewingRun) return;
    clearCandidate();
    setRunError('');
    onStart?.();
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setPicking(true);
    setVerified(undefined);
    setError('');
    setMessage('在右侧网页点选目标，按 Esc 取消');
    try {
      await open();
      if (!alive.current || request.current !== requestId) return;
      await api('browser.embedded.pick.start', { requestId });
      if (!alive.current || request.current !== requestId) {
        await api('browser.embedded.pick.cancel', { requestId });
        return;
      }
      while (alive.current && request.current === requestId) {
        const state: PickerState = await api('browser.embedded.pick.status', { requestId });
        if (!alive.current || request.current !== requestId) return;
        if (state.phase === 'selected' && state.target) {
          request.current = '';
          setPicking(false);
          if (confirmBeforeApply) {
            const next = { target: state.target, requestId };
            pending.current = next;
            setCandidate(next);
            setMessage('');
          } else {
            select.current(state.target, requestId);
            setMessage('已选取 · ' + state.target.label);
          }
          return;
        }
        if (state.phase === 'error') throw new Error(state.error || '选取失败');
        if (state.phase === 'cancelled') {
          setMessage('选取已结束，请重新选取');
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {
      if (alive.current && request.current === requestId)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current && request.current === requestId) {
        request.current = '';
        setPicking(false);
      }
    }
  };
  const validate = async () => {
    if (
      disabled ||
      !active ||
      !selector ||
      picking ||
      validating ||
      applying ||
      focusing ||
      viewingRun
    )
      return;
    clearCandidate();
    setRunError('');
    onStart?.();
    const current = ++version.current;
    setValidating(true);
    setVerified(undefined);
    setMessage('');
    setError('');
    try {
      await open();
      if (!alive.current || version.current !== current) return;
      const target: ElementTarget = await api('browser.embedded.pick.validate', {
        selector,
        framePath,
      });
      if (!alive.current || version.current !== current) return;
      inspect.current(target);
      setVerified(target);
    } catch (e) {
      if (alive.current && version.current === current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current && version.current === current) setValidating(false);
    }
  };
  const discard = () => {
    version.current++;
    clearCandidate();
    setApplying(false);
    setError('');
    setMessage(
      purpose === 'task' ? '已放弃此目标，任务选择保持不变' : '已放弃待应用目标，原步骤保持不变',
    );
    pickButton.current?.focus();
  };
  const apply = async () => {
    const selected = pending.current;
    if (!selected || applying || focusing || disabled || !active) return;
    const current = ++version.current;
    setApplying(true);
    setError('');
    try {
      if (selected.focused) await open();
      if (!alive.current || version.current !== current || pending.current !== selected) return;
      const target: ElementTarget = selected.focused
        ? (
            await api('browser.embedded.pick.focus', {
              requestId: selected.requestId,
              action: 'confirm',
            })
          ).target
        : await api('browser.embedded.pick.confirm', { requestId: selected.requestId });
      if (!alive.current || version.current !== current || pending.current !== selected) return;
      await select.current(target, selected.requestId);
      if (!alive.current || version.current !== current || pending.current !== selected) return;
      clearCandidate();
      setMessage('已应用目标 · ' + (target.label || target.tag));
      requestAnimationFrame(() => {
        if (alive.current && pickButton.current?.getClientRects().length)
          pickButton.current.focus();
      });
    } catch (e) {
      if (alive.current && version.current === current && pending.current === selected) {
        clearCandidate();
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (alive.current && version.current === current) setApplying(false);
    }
  };
  const focusCandidate = async () => {
    const selected = pending.current;
    if (!selected || !browserFocus || focusing || applying || !canApply.current) return;
    const current = ++version.current;
    setFocusing(true);
    setError('');
    try {
      if (selected.focused) await open();
      if (!alive.current || version.current !== current || pending.current !== selected) return;
      const receipt: FocusedTarget = await api('browser.embedded.pick.focus', {
        requestId: selected.requestId,
        action: selected.focused ? 'confirm' : 'capture',
      });
      if (!alive.current || version.current !== current || pending.current !== selected) return;
      const next = { ...selected, target: receipt.target, focused: true };
      pending.current = next;
      setCandidate(next);
      browserFocus.open(receipt, async (target) => {
        if (
          !alive.current ||
          !canApply.current ||
          pending.current?.requestId !== selected.requestId
        )
          return false;
        setApplying(true);
        try {
          await select.current(target, selected.requestId);
          if (alive.current && pending.current?.requestId === selected.requestId) {
            clearCandidate();
            setMessage('已应用目标 · ' + (target.label || target.tag));
          }
        } finally {
          if (alive.current) setApplying(false);
        }
        return true;
      });
    } catch (reason) {
      if (alive.current && version.current === current)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current && version.current === current) setFocusing(false);
    }
  };
  const openRun = async () => {
    if (!blockingRunId || !viewRun.current || viewingRun || !active || disabled) return;
    const current = ++runRequest.current;
    setViewingRun(true);
    setRunError('');
    try {
      const detail = await api('run.detail', { id: blockingRunId });
      if (!alive.current || current !== runRequest.current) return;
      if (detail?.run?.id !== blockingRunId)
        throw new Error('运行详情与当前记录不一致，请重新查看');
      viewRun.current?.(detail, viewRunButton.current ?? undefined);
    } catch (reason) {
      if (alive.current && current === runRequest.current)
        setRunError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (alive.current && current === runRequest.current) setViewingRun(false);
    }
  };
  const shownTarget = candidate?.target ?? verified;
  const taskConfirmation = purpose === 'task' && !!candidate && !error;
  // Only classify reasons emitted by the existing host and embedded browser.
  const reason = error
    .replace(/^Error invoking remote method 'flowark:request': (?:Error: )?/, '')
    .replace(/^Error: /, '')
    .split('\n')[0];
  const busy = ['请先暂停当前任务，再选取或验证元素', '网页正在执行操作，请稍后选取'].includes(
    reason,
  );
  const changed = [
    '网页会话已关闭',
    '页面框架已变化，请重新选取',
    '目标在选取期间已被替换，请重新选取',
    '目标元素已离开页面',
    '选取已取消',
    '选取后的网页已变化，请重新选取',
    '没有此请求的已选网页目标，请重新选取',
    '选取已取消或改变，请重新选取',
    '网页已变化，请重新选取目标',
    '网页已变化，请重新选取',
    '所选元素内容或结构已变化，请重新选取',
    '目标引用已取消或改变',
    '网页选取已结束，请展开网页后重新选取',
  ].includes(reason);
  const multiple = reason === '选择器匹配多个元素';
  const feedback = error
    ? {
        tone: busy || changed ? 'warning' : 'error',
        badge: busy ? '运行互斥' : changed ? '请求失效' : '拒绝应用',
        title: busy || changed ? '当前无法拾取' : multiple ? '目标不唯一' : '未能确认目标',
        detail: reason,
        next: busy
          ? '先在运行详情暂停当前任务，等步骤停止后，再回来明确开始拾取。'
          : changed
            ? '核对右侧网页当前内容，再重新选取目标；旧请求不会作为新的选择。'
            : '核对网页与定位信息后重新拾取或验证；不会自动采用第一个相似元素。',
      }
    : picking
      ? {
          tone: 'info',
          badge: '正在拾取',
          title: '从网页选取目标',
          detail: '在右侧网页悬停高亮、点击选定；不会触发页面业务。按 Esc 可退出。',
        }
      : validating
        ? {
            tone: 'info',
            badge: '正在验证',
            title: '核对当前定位',
            detail: '正在核对选择器与框架路径，请等待验证结果。',
          }
        : candidate
          ? {
              tone: 'success',
              badge: applying ? '正在复核' : '待确认',
              title: '确认选取的目标',
              detail:
                purpose === 'task'
                  ? '尚未更改任务对象。确认后只将此元素加入任务，继续核对理解与方案。'
                  : '尚未修改步骤。应用时会重新核对网页与目标，原操作和填写值保持不变。',
            }
          : verified
            ? {
                tone: 'success',
                badge: '唯一匹配',
                title: '定位验证完成',
                detail: '当前定位唯一匹配。验证不修改步骤的填写值；网页变化后需要重新核对。',
              }
            : undefined;
  useImperativeHandle(controls, () => ({
    pick: () => void pick(),
    focus: () => {
      const target =
        region.current?.querySelector<HTMLElement>('.element-picker-feedback') ??
        pickButton.current;
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus({ preventScroll: true });
    },
  }));
  return (
    <div className="element-picker" ref={region}>
      <div className="element-picker-actions">
        <Button
          type={purpose === 'task' ? 'default' : 'primary'}
          ref={pickButton}
          disabled={
            !active ||
            disabled ||
            picking ||
            validating ||
            applying ||
            focusing ||
            viewingRun ||
            undefined
          }
          onClick={() => void pick()}
        >
          <Crosshair size={15} />
          {pickLabel ?? (candidate || error || message ? '重新拾取' : '从网页选取')}
        </Button>
        {picking ? (
          <Button onClick={() => void cancel()}>
            <X size={14} />
            取消拾取
          </Button>
        ) : allowInspect ? (
          <Button
            disabled={
              !active ||
              disabled ||
              !selector ||
              validating ||
              applying ||
              focusing ||
              viewingRun ||
              undefined
            }
            onClick={() => void validate()}
          >
            <Check size={14} />
            {validating ? '验证中…' : '验证定位'}
          </Button>
        ) : null}
      </div>
      {feedback && (
        <section
          className={`element-picker-feedback${taskConfirmation ? ' is-task-confirmation' : ''}`}
          role={error ? 'alert' : 'status'}
          aria-label={feedback.title}
          tabIndex={-1}
        >
          <Card
            className="element-picker-card"
            variant={taskConfirmation ? 'borderless' : 'outlined'}
            styles={taskConfirmation ? { body: { padding: 0 } } : undefined}
          >
            {!taskConfirmation && (
              <Tag
                className="run-state-tag"
                variant="filled"
                color={elementPickerColors[feedback.tone]}
                icon={<Badge status={elementPickerColors[feedback.tone]} />}
              >
                {feedback.badge}
              </Tag>
            )}
            {!taskConfirmation && <h3>{feedback.title}</h3>}
            <p>{feedback.detail}</p>
            {taskConfirmation && candidate?.target.structural && (
              <p>使用结构定位，页面布局变化后请重新选取。</p>
            )}
            {'next' in feedback && <p>{feedback.next}</p>}
            {shownTarget && !error && !picking && !validating && !taskConfirmation && (
              <div className="element-picker-target">
                <span>目标</span>
                <strong>{shownTarget.label || shownTarget.tag}</strong>
                <span>
                  {shownTarget.tag} ·{' '}
                  {shownTarget.framePath.length
                    ? `${shownTarget.framePath.length} 层框架`
                    : '主页面'}
                </span>
                {shownTarget.structural && <span>使用结构定位，页面布局变化后请重新验证。</span>}
              </div>
            )}
            {candidate && (
              <div className="element-picker-apply-actions">
                <Button
                  ref={applyButton}
                  type="primary"
                  disabled={!active || disabled || applying || focusing || undefined}
                  onClick={() => void apply()}
                >
                  {applying ? '正在核对目标…' : purpose === 'task' ? '使用这个目标' : '应用目标'}
                </Button>
                {browserFocus && (
                  <Button
                    disabled={!active || disabled || applying || focusing || undefined}
                    onClick={() => void focusCandidate()}
                  >
                    {focusing ? '正在核对目标…' : '聚焦选中目标'}
                  </Button>
                )}
                <Button onClick={discard}>放弃此目标</Button>
              </div>
            )}
            {busy && blockingRunId && onViewRun && (
              <Button
                ref={viewRunButton}
                disabled={!active || disabled || viewingRun || undefined}
                onClick={() => void openRun()}
              >
                {viewingRun ? '正在读取运行…' : '查看运行'}
              </Button>
            )}
            {runError && (
              <p className="field-error" role="alert">
                {runError}
              </p>
            )}
            {error && onAdjust && (
              <Button disabled={!active || disabled || undefined} onClick={onAdjust}>
                手动调整定位
              </Button>
            )}
          </Card>
        </section>
      )}
      {message && !feedback && (
        <p className="picker-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
