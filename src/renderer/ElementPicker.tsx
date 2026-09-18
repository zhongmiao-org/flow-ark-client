import { useEffect, useRef, useState } from 'react';
import { Crosshair, Check, X } from 'lucide-react';
import type { ElementTarget, PickerState } from '../shared/element-picker';
const api = (method: string, args: any = {}) => window.flowark.request(method, args);
export default function ElementPicker({
  selector,
  framePath,
  onSelect,
  onInspect,
}: {
  selector: string;
  framePath: string[];
  onSelect: (target: ElementTarget) => void;
  onInspect: (target: ElementTarget) => void;
}) {
  const [picking, setPicking] = useState(false),
    [validating, setValidating] = useState(false);
  const [message, setMessage] = useState(''),
    [error, setError] = useState('');
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
    version.current++;
    const id = request.current;
    if (id) {
      request.current = '';
      setPicking(false);
      void api('browser.embedded.pick.cancel', { requestId: id }).catch(() => {});
    }
  }, [selector, JSON.stringify(framePath)]);
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
    const requestId = crypto.randomUUID();
    request.current = requestId;
    setPicking(true);
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
          select.current(state.target);
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
    const current = ++version.current;
    setValidating(true);
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
      setMessage('唯一匹配 · ' + target.label);
    } catch (e) {
      if (alive.current && version.current === current)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setValidating(false);
    }
  };
  return (
    <div className="element-picker">
      <div className="element-picker-actions">
        <button className="primary" disabled={picking || validating} onClick={() => void pick()}>
          <Crosshair size={15} />
          从网页选取
        </button>
        {picking ? (
          <button onClick={() => void cancel()}>
            <X size={14} />
            取消
          </button>
        ) : (
          <button disabled={!selector || validating} onClick={() => void validate()}>
            <Check size={14} />
            {validating ? '验证中…' : '验证定位'}
          </button>
        )}
      </div>
      {message && (
        <p className="picker-message" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
