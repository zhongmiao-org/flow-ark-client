import type { BrowserBinding, FlowRecord, Run } from '../shared/types';
import type { EmbeddedReview } from '../shared/run-review';
import type { RunTargetContext } from '../shared/run-target-context';
import { walk } from '../core/validate';
import { redact } from '../shared/utils';

type Snapshot = FlowRecord & {
  runReviewAuthorization?: { browsers: BrowserBinding[]; embedded?: EmbeddedReview };
};

export function runTargetContext(
  run: Run | undefined,
  snapshot: Snapshot | undefined,
  secrets: string[],
): RunTargetContext | undefined {
  if (
    !run ||
    !snapshot ||
    snapshot.id !== run.flowId ||
    snapshot.flow.id !== run.flowId ||
    (snapshot.versionId && snapshot.versionId !== run.versionId)
  )
    return undefined;
  const nodes = walk(snapshot.flow.steps);
  const files = [
    ...new Set(
      nodes.flatMap((node) =>
        node.type === 'file' || node.type === 'excel' ? [node.binding] : [],
      ),
    ),
  ].map((binding) => ({ binding, directory: snapshot.bindings.files[binding] }));
  const bindingId = snapshot.bindings.browserId;
  let browser: RunTargetContext['browser'];
  if (bindingId && nodes.some((node) => node.type === 'browser')) {
    const authorization = snapshot.runReviewAuthorization;
    const saved = authorization?.browsers.find((entry) => entry.id === bindingId);
    browser = { bindingId, product: bindingId === 'embedded' ? 'embedded' : saved?.product };
    if (bindingId === 'embedded') {
      const selected = snapshot.webTarget?.page;
      const reviewed = authorization?.embedded;
      if (selected) browser.page = { title: selected.title, url: selected.url, source: 'selected' };
      else if (reviewed?.started && !reviewed.loading && !reviewed.blocked)
        browser.page = { title: reviewed.title, url: reviewed.url, source: 'reviewed' };
    }
  }
  return redact(
    {
      formatVersion: 1,
      runId: run.id,
      versionId: run.versionId,
      browser,
      files,
      ...(snapshot.desktopTarget?.binding
        ? { desktop: { windowTitle: snapshot.desktopTarget.binding.windowTitle } }
        : {}),
    },
    secrets,
  );
}
