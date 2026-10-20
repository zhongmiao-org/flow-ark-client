import { Alert, Button, Card, Space, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  fieldsPickCandidateSchema,
  fieldsPickStateSchema,
  type FieldsPickCandidate,
  type FieldsPickScope,
} from '../shared/browser-field-picking';
import {
  parseRenderingInspection,
  renderingInspectionStatusSchema,
  type RenderingInspection,
  type RenderingLocation,
  type AncestorSpaceRule,
} from '../shared/browser-rendering-diagnostics';

const issueLabels = {
  'hidden-target': '目标或祖先不可见',
  'hidden-descendant': '后代不可见',
  'line-clamp': '行数截断',
  'overflow-clip': '溢出裁剪',
  'unsupported-layout': '无法核准的排版',
  'embedded-content': '嵌入内容',
  'generated-content': '生成内容',
};
const ancestorSpaceLabels: Record<AncestorSpaceRule, string> = {
  'ordinary-space': '普通空格字面量',
  position: '定位方式',
  float: '浮动方式',
  'z-index': '层级',
  'background-image': '背景图像',
  'border-image-source': '边框图像',
  'outline-style': '轮廓描边',
  'box-shadow': '盒阴影',
  'text-shadow': '文字阴影',
  'text-decoration-line': '文字装饰',
  'text-emphasis-style': '文字强调',
  '-webkit-text-stroke-width': '文字描边',
  filter: '滤镜',
  'backdrop-filter': '背景滤镜',
  transform: '变换',
  perspective: '透视',
  clip: '裁剪区域',
  'clip-path': '裁剪路径',
  'mask-image': '遮罩图像',
  '-webkit-mask-box-image-source': '边框遮罩',
  opacity: '不透明度',
  'mix-blend-mode': '混合模式',
  visibility: '可见性',
  'content-visibility': '内容可见性',
  'animation-name': '动画',
  contain: '布局与绘制包含',
  'overflow-x': '横向溢出',
  'overflow-y': '纵向溢出',
  '-webkit-box-reflect': '镜像反射',
  rotate: '旋转',
  scale: '缩放',
  translate: '平移',
  zoom: '页面缩放',
  display: '显示方式',
  'white-space': '换行规则',
  'background-color': '背景颜色',
  'border-width': '边框宽度',
  'transition-duration': '过渡时长',
};
const positionLabel = (location: RenderingLocation) => {
  const scope =
    location.scope === 'target'
      ? '目标'
      : location.scope === 'ancestor'
        ? `祖先第 ${location.depth} 层`
        : location.scope === 'frame-ancestor'
          ? `框架祖先第 ${location.depth} 层`
          : location.scope === 'descendant'
            ? `后代第 ${location.depth} 层`
            : '位置无法关联';
  return [scope, location.tag?.toUpperCase(), location.pseudo && `::${location.pseudo}`]
    .filter(Boolean)
    .join(' · ');
};

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
  rendered = false,
  renderPolicy = 'bounded-rendered-text-v1',
  beforeStart,
  onApply,
}: {
  scope?: FieldsPickScope;
  selector?: string;
  framePath: string[];
  sourceKey: string;
  reason?: string;
  rendered?: boolean;
  renderPolicy?:
    | 'bounded-rendered-text-v1'
    | 'bounded-rendered-text-v2'
    | 'bounded-selection-text-v1'
    | 'bounded-selection-text-v2';
  beforeStart?: () => boolean;
  onApply: (candidate: FieldsPickCandidate) => void;
}) {
  const key = JSON.stringify([
    scope,
    selector,
    framePath,
    sourceKey,
    reason,
    rendered,
    renderPolicy,
  ]);
  const current = useRef({ key, onApply, beforeStart });
  current.current = { key, onApply, beforeStart };
  const request = useRef<{ id: string; key: string } | undefined>(undefined);
  const alive = useRef(true);
  const [phase, setPhase] = useState<
    'idle' | 'picking' | 'candidate' | 'applying' | 'validating' | 'diagnosing'
  >('idle');
  const [candidate, setCandidate] = useState<FieldsPickCandidate>();
  const [error, setError] = useState('');
  const [verified, setVerified] = useState(false);
  const [inspection, setInspection] = useState<RenderingInspection>();
  const inspectionRef = useRef<RenderingInspection | undefined>(undefined);
  const inspectionKey = useRef('');
  const clearInspection = () => {
    inspectionRef.current = undefined;
    setInspection(undefined);
  };
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
    clearInspection();
  }, [key]);
  const isCurrent = (owner: { id: string; key: string }) =>
    alive.current && request.current === owner && current.current.key === owner.key;
  const cancel = () => {
    cancelRequest();
    setCandidate(undefined);
    setPhase('idle');
    setError('');
    setVerified(false);
    clearInspection();
  };
  useEffect(() => {
    if (!inspection) return;
    const expectedKey = key;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const valid = () =>
      live &&
      alive.current &&
      current.current.key === expectedKey &&
      inspectionRef.current === inspection;
    const poll = async () => {
      try {
        const status = renderingInspectionStatusSchema.parse(
          await api('browser.embedded.fields.rendering.status', { source: inspection.source }),
        );
        if (!valid()) return;
        if (!status.current) {
          clearInspection();
          setError('当前网页已变化或不可用，请重新查看拒绝位置');
          return;
        }
      } catch (e) {
        if (!valid()) return;
        clearInspection();
        setError(message(e));
        return;
      }
      if (valid()) timer = setTimeout(() => void poll(), 500);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [inspection, key]);
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
    clearInspection();
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
    clearInspection();
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
  const diagnose = async () => {
    if (
      !rendered ||
      scope?.kind !== 'field' ||
      reason ||
      !selector?.trim() ||
      phase !== 'idle' ||
      current.current.beforeStart?.() === false
    )
      return;
    const owner = { id: crypto.randomUUID(), key };
    const input = {
      version: 1 as const,
      requestId: owner.id,
      root: scope.root,
      selector,
      ...(renderPolicy === 'bounded-rendered-text-v2'
        ? { policy: renderPolicy, details: 'ancestor-space-checks-v1' as const }
        : renderPolicy === 'bounded-selection-text-v1' ||
            renderPolicy === 'bounded-selection-text-v2'
          ? { policy: renderPolicy }
          : {}),
    };
    request.current = owner;
    clearInspection();
    setPhase('diagnosing');
    setError('');
    setVerified(false);
    try {
      await open();
      if (!isCurrent(owner)) return;
      const value = parseRenderingInspection(
        await api('browser.embedded.fields.rendering.inspect', input),
        input,
      );
      if (!isCurrent(owner)) return;
      inspectionRef.current = value;
      inspectionKey.current = owner.key;
      setInspection(value);
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
        {rendered && !root && (
          <Button
            disabled={!!reason || scope?.kind !== 'field' || !selector?.trim() || phase !== 'idle'}
            loading={phase === 'diagnosing'}
            onClick={() => void diagnose()}
          >
            查看拒绝位置
          </Button>
        )}
        {(phase !== 'idle' || inspection) && (
          <Button onClick={cancel}>
            {phase === 'diagnosing' ? '取消本次诊断' : inspection ? '清除诊断' : '取消本次候选'}
          </Button>
        )}
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
      {inspection && inspectionKey.current === key && (
        <Card
          size="small"
          className="fields-rendering-diagnostic"
          title="当前字段 · 拒绝原因与位置"
          role="status"
        >
          <p>本次检查不读取正文；页面或定位变化后请重新检查，诊断不写入历史。</p>
          <p>
            {inspection.issues.length
              ? inspection.issues.map((s) => issueLabels[s]).join('、')
              : '本次有限检查未发现拒绝原因；不代表正文完整。'}
          </p>
          {inspection.policy === 'bounded-rendered-text-v2' && (
            <p>
              本次核准无绘制祖先空格 {inspection.ignoredAncestorSpaces}{' '}
              处；未读取正文，仍须在正式运行中核对全文。
            </p>
          )}
          {(inspection.policy === 'bounded-selection-text-v1' ||
            inspection.policy === 'bounded-selection-text-v2') && (
            <p>
              本次核准无绘制祖先空格 {inspection.ignoredAncestorSpaces} 处；选区外祖先装饰{' '}
              {inspection.excludedAncestorDecorations}{' '}
              处（可能绘制）。外部覆盖未核验，未读取正文，不代表完整正文或岗位资格。
            </p>
          )}
          {inspection.policy === 'bounded-selection-text-v2' && (
            <p>
              本次跳过隐藏空叶子 {inspection.excludedHiddenEmptyLeaves}{' '}
              处；隐藏非空正文仍拒绝，外部覆盖未核验。
            </p>
          )}
          {inspection.truncated && (
            <Alert
              type="warning"
              title="位置记录已达到 32 项上限；拒绝原因仍保留，未列出的位置不代表不存在。"
            />
          )}
          <ol aria-label="拒绝位置列表">
            {inspection.locations.map((location, i) => (
              <li key={i}>
                <strong>{positionLabel(location)}</strong>：{issueLabels[location.issue]}
                {location.contentKind && (
                  <span>
                    {' '}
                    · {location.contentKind === 'whitespace-string' ? '空白字符串' : '其他生成内容'}
                    ；正文仍未采用
                  </span>
                )}
                {location.ancestorSpace && (
                  <div>
                    <p>未通过的祖先空格检查（仍按原规则拒绝）：</p>
                    <ul aria-label="祖先空格未通过的检查项">
                      {location.ancestorSpace.failures.map((failure) => (
                        <li key={failure.rule}>
                          {ancestorSpaceLabels[failure.rule]}：
                          {failure.state === 'unavailable'
                            ? '浏览器未提供可判断值'
                            : '不符合现有规则'}
                        </li>
                      ))}
                    </ul>
                    {location.ancestorSpace.more && (
                      <p>此位置仅列出前8项未通过条件，仍有其他条件未通过。</p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p>
            已检查 {inspection.scannedElements} 个元素 / {inspection.scannedNodes}{' '}
            个节点；仅限此刻页面及当前有限策略。
          </p>
        </Card>
      )}
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
