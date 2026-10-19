import type { Step } from '../shared/types';
import type { DesktopReceipt } from '../shared/desktop-run';
import type { RunPresentationInput } from './run-presentation';
import type { RunTargetContext } from '../shared/run-target-context';

export function verifiedDesktopReceipt(
  receipt: DesktopReceipt | undefined,
  node: Step | undefined,
) {
  return (
    node?.type === 'desktop' &&
    receipt?.nodeId === node.id &&
    receipt.status === 'verified' &&
    !!receipt.completedAt &&
    receipt.readback === node.text &&
    typeof receipt.original === 'string'
  );
}
export type DesktopRunInput = RunPresentationInput & {
  desktopReceipts?: DesktopReceipt[];
  targetContext?: RunTargetContext;
};
export function desktopRunPresentation(input: DesktopRunInput, terminal: boolean, active: boolean) {
  const node = input.snapshot?.steps[0];
  if (input.snapshot?.steps.length !== 1 || node?.type !== 'desktop') return;
  const matching = (input.desktopReceipts ?? []).filter(
    (r) => r.runId === input.run.id && r.nodeId === node.id,
  );
  const receipt = matching.length === 1 ? matching[0] : undefined;
  const verified = verifiedDesktopReceipt(receipt, node);
  const phase = verified
    ? 'verified'
    : receipt?.status === 'not-written' && !!receipt.completedAt
      ? 'not-written'
      : receipt?.status === 'verified' ||
          (receipt?.status === 'not-written' && !receipt.completedAt)
        ? 'unknown'
        : receipt?.status === 'unknown'
          ? !receipt.completedAt && !terminal && active
            ? 'writing'
            : 'unknown'
          : terminal
            ? 'missing'
            : 'waiting';
  const target = input.targetContext;
  const windowTitle =
    target?.runId === input.run.id &&
    target.versionId === input.run.versionId &&
    target.formatVersion === 1
      ? target.desktop?.windowTitle
      : undefined;
  return {
    node,
    receipt,
    phase,
    windowTitle,
    needsReview:
      phase === 'unknown' || (terminal && phase !== 'verified' && input.run.state === 'SUCCEEDED'),
    title: {
      verified: '选中段落已修改并回读一致',
      'not-written': '本次没有发出文字修改',
      writing: '正在等待修改与回读结果',
      unknown: '应用修改结果需要人工核对',
      missing: '尚未取得应用修改回执',
      waiting:
        input.run.state === 'QUEUED'
          ? '等待本次应用试运行'
          : input.run.state === 'PAUSED'
            ? '应用试运行已暂停'
            : '正在核对窗口与原选区',
    }[phase],
    effect: {
      verified: '回执确认当时的选区文字已替换并回读一致；没有自动保存文档。',
      'not-written': '回执确认本次未发出文字修改；再次尝试前需要重新核对窗口与原文。',
      writing: '修改尝试已记录，正在等待回执；此时取消不能证明原文未改。',
      unknown: '文档可能已经改变，请到原窗口人工核对；不会自动重试。',
      missing: '没有取得可核对的修改回执，不能仅凭运行状态判断原文是否改变。',
      waiting: '尚未取得修改回执；执行前会核对原窗口、原选区与单次授权。',
    }[phase],
  };
}
export type DesktopRunModel = NonNullable<ReturnType<typeof desktopRunPresentation>>;
