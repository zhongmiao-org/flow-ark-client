import { useEffect, useRef, useState } from 'react';
import { Crosshair, Check, X } from 'lucide-react';
import type { ElementTarget, PickerState } from '../shared/element-picker';
import './element-picker.css';
const api = (method: string, args: any = {}) => window.flowark.request(method, args);
export default function ElementPicker({
  selector,
  framePath,
  onSelect,
  onInspect,
  onStart,
  onAdjust,
  allowInspect = true,
  disabled = false,
  active = true,
}: {
  selector: string;
  framePath: string[];
  onSelect: (target: ElementTarget, requestId: string) => void;
  onInspect: (target: ElementTarget) => void;
  onStart?: () => void;
  onAdjust?: () => void;
  allowInspect?: boolean;
  disabled?: boolean;
  active?: boolean;
}) {
  const [picking, setPicking] = useState(false),
    [validating, setValidating] = useState(false);
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const [verified, setVerified] = useState<ElementTarget>();
  const request = useRef(''),
    version = useRef(0),
    alive = useRef(true);
  const select = useRef(onSelect),
    inspect = useRef(onInspect);
  select.current = onSelect;
  inspect.current = onInspect;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      version.current++;
      const id = request.current;
      request.current = '';
      if (id) void api('browser.embedded.pick.cancel', { requestId: id }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    setMessage('');
    setError('');
    setVerified(undefined);
    setValidating(false);
    version.current++;
    const id = request.current;
    if (id) {
      request.current = '';
      setPicking(false);
      void api('browser.embedded.pick.cancel', { requestId: id }).catch(() => {});
    }
  }, [selector, JSON.stringify(framePath), active]);
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
    if (disabled || !active || picking || validating) return;
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
          select.current(state.target, requestId);
          setMessage('已选取 · ' + state.target.label);
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
    if (disabled || !active || !selector || picking || validating) return;
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
  // Only classify reasons emitted by the existing host and embedded browser.
  const reason = error.replace(/^Error: /, '').split('\n')[0];
  const busy = ['请先暂停当前任务，再选取或验证元素', '网页正在执行操作，请稍后选取'].includes(
    reason,
  );
  const changed = [
    '网页会话已关闭',
    '页面框架已变化，请重新选取',
    '目标在选取期间已被替换，请重新选取',
    '目标元素已离开页面',
    '选取已取消',
  ].includes(reason);
  const multiple = reason === '选择器匹配多个元素';
  const feedback = error
    ? {
        tone: busy || changed ? 'warning' : 'error',
        badge: busy ? '运行互斥' : changed ? '请求失效' : '拒绝应用',
        title: busy || changed ? '当前无法拾取' : multiple ? '目标不唯一' : '未能确认目标',
        detail: error,
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
        : verified
          ? {
              tone: 'success',
              badge: '唯一匹配',
              title: '定位验证完成',
              detail: '当前定位唯一匹配。验证不修改步骤的填写值；网页变化后需要重新核对。',
            }
          : undefined;
  return (
    <div className="element-picker">
      <div className="element-picker-actions">
        <button
          className="primary"
          disabled={!active || disabled || picking || validating}
          onClick={() => void pick()}
        >
          <Crosshair size={15} />
          {error || message ? '重新拾取' : '从网页选取'}
        </button>
        {picking ? (
          <button onClick={() => void cancel()}>
            <X size={14} />
            取消拾取
          </button>
        ) : allowInspect ? (
          <button
            disabled={!active || disabled || !selector || validating}
            onClick={() => void validate()}
          >
            <Check size={14} />
            {validating ? '验证中…' : '验证定位'}
          </button>
        ) : null}
      </div>
      {feedback && (
        <section
          className={`element-picker-feedback is-${feedback.tone}`}
          role={error ? 'alert' : 'status'}
          aria-label={feedback.title}
        >
          <span className="element-picker-badge">{feedback.badge}</span>
          <h3>{feedback.title}</h3>
          <p>{feedback.detail}</p>
          {'next' in feedback && <p>{feedback.next}</p>}
          {verified && !error && !picking && !validating && (
            <div className="element-picker-target">
              <span>目标</span>
              <strong>{verified.label || verified.tag}</strong>
              <span>
                {verified.tag} ·{' '}
                {verified.framePath.length ? `${verified.framePath.length} 层框架` : '主页面'}
              </span>
              {verified.structural && <span>使用结构定位，页面布局变化后请重新验证。</span>}
            </div>
          )}
          {error && onAdjust && (
            <button disabled={!active || disabled} onClick={onAdjust}>
              手动调整定位
            </button>
          )}
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
