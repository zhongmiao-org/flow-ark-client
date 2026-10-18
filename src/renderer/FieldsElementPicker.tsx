import { Alert, Button, Card, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  fieldsPickCandidateSchema,
  fieldsPickStateSchema,
  type FieldsPickCandidate,
  type FieldsPickScope,
} from '../shared/browser-field-picking';

const api = (method: string, args: unknown) => window.flowark.request(method, args);
const message = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .split('\n')[0]
    .replace(/^Error:\s*/, '')
    .slice(0, 2000);
export default function FieldsElementPicker({
  scope,
  selector,
  framePath,
  sourceKey,
  reason,
  beforeStart,
  onApply,
}: {
  scope?: FieldsPickScope;
  selector?: string;
  framePath: string[];
  sourceKey: string;
  reason?: string;
  beforeStart?: () => boolean;
  onApply: (candidate: FieldsPickCandidate) => void;
}) {
  const key = JSON.stringify([scope, selector, framePath, sourceKey, reason]);
  const current = useRef({ key, onApply, beforeStart });
  current.current = { key, onApply, beforeStart };
  const request = useRef<{ id: string; key: string } | undefined>(undefined);
  const alive = useRef(true);
  const [phase, setPhase] = useState<'idle' | 'picking' | 'candidate' | 'applying' | 'validating'>(
    'idle',
  );
  const [candidate, setCandidate] = useState<FieldsPickCandidate>();
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);
  const applyButton = useRef<HTMLButtonElement>(null);
  const cancelRequest = () => {
    const owner = request.current;
    request.current = undefined;
    if (owner)
      void api('browser.embedded.fields.pick.cancel', { requestId: owner.id }).catch(() => {});
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancelRequest();
    };
  }, []);
  useEffect(() => {
    cancelRequest();
    setPhase('idle');
    setCandidate(undefined);
    setError('');
    setVerified(false);
  }, [key]);
  const isCurrent = (owner: { id: string; key: string }) =>
    alive.current && request.current === owner && current.current.key === owner.key;
  const cancel = () => {
    cancelRequest();
    setCandidate(undefined);
    setPhase('idle');
    setError('');
    setVerified(false);
  };
  useEffect(() => {
    if (!candidate) return;
    applyButton.current?.focus();
    const owner = request.current;
    if (!owner) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = fieldsPickStateSchema.parse(
          await api('browser.embedded.fields.pick.status', { requestId: owner.id }),
        );
        if (!live || !isCurrent(owner)) return;
        if (
          state.phase !== 'selected' ||
          JSON.stringify(state.candidate) !== JSON.stringify(candidate)
        ) {
          cancelRequest();
          setCandidate(undefined);
          setPhase('idle');
          setError(state.phase === 'error' ? message(state.error) : '候选已失效，请重新选取');
          return;
        }
      } catch (e) {
        if (!live || !isCurrent(owner)) return;
        cancelRequest();
        setCandidate(undefined);
        setPhase('idle');
        setError(message(e));
        return;
      }
      if (live) timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [candidate]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !request.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, []);
  const open = async () => {
    window.dispatchEvent(new Event('flowark:open-browser'));
    await api('browser.embedded.enable', {});
    await api('browser.embedded.visibility', { visible: true });
  };
  const start = async () => {
    if (!scope || reason || phase !== 'idle' || current.current.beforeStart?.() === false) return;
    const owner = { id: crypto.randomUUID(), key };
    request.current = owner;
    setPhase('picking');
    setError('');
    setVerified(false);
    try {
      await open();
      if (!isCurrent(owner)) return;
      let state = fieldsPickStateSchema.parse(
        await api('browser.embedded.fields.pick.start', { requestId: owner.id, scope }),
      );
      while (isCurrent(owner)) {
        if (state.requestId !== owner.id) throw Error('拾取响应与当前请求不一致');
        if (state.phase === 'selected') {
          setCandidate(state.candidate);
          setPhase('candidate');
          return;
        }
        if (state.phase === 'error') throw Error(state.error);
        if (state.phase === 'cancelled') throw Error('选取已取消或失效，请重新选取');
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (!isCurrent(owner)) return;
        state = fieldsPickStateSchema.parse(
          await api('browser.embedded.fields.pick.status', { requestId: owner.id }),
        );
      }
    } catch (e) {
      if (isCurrent(owner)) {
        cancelRequest();
        setPhase('idle');
        setError(message(e));
      }
    }
  };
  const validate = async () => {
    if (
      !scope ||
      reason ||
      !selector?.trim() ||
      phase !== 'idle' ||
      current.current.beforeStart?.() === false
    )
      return;
    const owner = { id: crypto.randomUUID(), key };
    request.current = owner;
    setPhase('validating');
    setError('');
    setVerified(false);
    try {
      await open();
      if (!isCurrent(owner)) return;
      const value = fieldsPickCandidateSchema.parse(
        await api('browser.embedded.fields.pick.validate', { scope, selector, framePath }),
      );
      if (!isCurrent(owner)) return;
      if (value.kind !== scope.kind) throw Error('定位验证类型与当前配置不一致');
      setVerified(true);
    } catch (e) {
      if (isCurrent(owner)) setError(message(e));
    } finally {
      if (isCurrent(owner)) {
        request.current = undefined;
        setPhase('idle');
      }
    }
  };
  const apply = async () => {
    const owner = request.current;
    if (!owner || !candidate || !isCurrent(owner) || phase !== 'candidate') return;
    setPhase('applying');
    setError('');
    try {
      const value = fieldsPickCandidateSchema.parse(
        await api('browser.embedded.fields.pick.confirm', { requestId: owner.id }),
      );
      if (!isCurrent(owner)) return;
      if (JSON.stringify(value) !== JSON.stringify(candidate))
        throw Error('候选已变化，请重新选取');
      cancelRequest();
      setCandidate(undefined);
      setPhase('idle');
      current.current.onApply(value);
    } catch (e) {
      if (!isCurrent(owner)) return;
      cancelRequest();
      setCandidate(undefined);
      setPhase('idle');
      setError(message(e));
    }
  };
  const root = scope?.kind === 'root';
  return (
    <section
      className="fields-element-picker"
      aria-label={root ? '根元素拾取与验证' : '关联字段拾取与验证'}
    >
      <Space wrap>
        <Button disabled={!!reason || !scope || phase !== 'idle'} onClick={() => void start()}>
          {root ? '选取唯一根' : '在根内选取字段'}
        </Button>
        <Button
          disabled={!!reason || !scope || !selector?.trim() || phase !== 'idle'}
          onClick={() => void validate()}
          loading={phase === 'validating'}
        >
          {root ? '验证根定位' : '验证当前字段'}
        </Button>
        {phase !== 'idle' && <Button onClick={cancel}>取消本次候选</Button>}
      </Space>
      {reason && <p>{reason}</p>}
      {phase === 'picking' && (
        <p role="status">
          在右侧网页选取{root ? '根元素' : '根内部字段'}；按 Esc 取消，不点击网页控件。
        </p>
      )}
      {verified && (
        <p role="status">刚才验证时唯一匹配；页面变化后请重新验证。定位不证明正文完整。</p>
      )}
      {error && <Alert type="error" title={error} role="alert" />}
      {candidate && (
        <Card size="small" className="fields-pick-candidate">
          <Tag color="processing">待采用 · {candidate.label || candidate.tag}</Tag>
          <p>根：{candidate.root.selector}</p>
          <p>
            框架：
            {candidate.root.framePath.length ? candidate.root.framePath.join(' → ') : '顶层文档'}
          </p>
          {candidate.field && <p>相对根定位：{candidate.field.selector}</p>}
          {candidate.structural && <p>包含结构定位，页面布局变化后需要重新核对。</p>}
          <p>尚未改写配置；采用时再次核对原文档、根与目标。</p>
          <Button
            ref={applyButton}
            type="primary"
            onClick={() => void apply()}
            loading={phase === 'applying'}
          >
            {root ? '应用根与框架' : '采用候选定位'}
          </Button>
        </Card>
      )}
    </section>
  );
}
