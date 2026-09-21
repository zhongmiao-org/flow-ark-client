import type { Run } from '../shared/types';
import type {
  RunReviewConfirmation,
  RunReviewInput,
  RunReviewOutcome,
  RunReviewPreview,
} from '../shared/run-review';

type Attempt = {
  input: RunReviewConfirmation;
  preview: RunReviewPreview;
  phase: 'pending' | 'unknown' | 'rejected' | 'created';
  run?: Run;
  message?: string;
};
export type ReviewState = {
  active: boolean;
  selection?: RunReviewInput;
  loading: boolean;
  opening: boolean;
  reviewed: boolean;
  preview?: RunReviewPreview;
  attempt?: Attempt;
  error: string;
};
const context = (selection: RunReviewInput) =>
  JSON.stringify([selection.id, selection.task?.id, selection.rerun?.runId]);
const message = (error: unknown) => (error instanceof Error ? error.message : '请求未完成');

/** One visible page, with receipts retained per task when the user navigates away. */
export class RunReviewSession {
  private state: ReviewState = {
    active: false,
    loading: false,
    opening: false,
    reviewed: false,
    error: '',
  };
  private listeners = new Set<() => void>();
  private attempts = new Map<string, Attempt>();
  private generation = 0;
  private source = '';
  constructor(
    private request: (method: string, args: unknown) => Promise<any>,
    private openDetail: (detail: any) => void,
    private newId: () => string = () => crypto.randomUUID(),
  ) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(next: Partial<ReviewState> = {}) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener();
  }
  private current(generation: number) {
    return this.state.active && generation === this.generation;
  }
  private put(key: string, attempt: Attempt) {
    this.attempts.set(key, attempt);
    if (this.state.selection && context(this.state.selection) === key) this.publish({ attempt });
  }
  enter(selection: RunReviewInput, source: string) {
    const next = JSON.stringify({ selection, source });
    if (this.state.active && this.source === next) return;
    this.source = next;
    this.generation++;
    const attempt = this.attempts.get(context(selection));
    this.publish({
      active: true,
      selection: structuredClone(selection),
      preview: undefined,
      reviewed: false,
      loading: false,
      opening: false,
      error: '',
      attempt,
    });
    if (!attempt) void this.refresh();
  }
  leave() {
    this.generation++;
    this.publish({
      active: false,
      preview: undefined,
      reviewed: false,
      loading: false,
      opening: false,
      error: '',
    });
  }
  setReviewed(reviewed: boolean) {
    if (
      this.state.active &&
      this.state.preview?.ready &&
      !this.state.loading &&
      !this.state.attempt
    )
      this.publish({ reviewed });
  }
  async refresh(debug = !!this.state.selection?.debug) {
    if (
      !this.state.active ||
      !this.state.selection ||
      ['pending', 'unknown'].includes(this.state.attempt?.phase ?? '')
    )
      return;
    const selection = { ...this.state.selection, debug };
    this.attempts.delete(context(selection));
    const generation = ++this.generation;
    this.publish({
      selection,
      loading: true,
      preview: undefined,
      reviewed: false,
      attempt: undefined,
      error: '',
      opening: false,
    });
    try {
      const preview: RunReviewPreview = await this.request('flow.run.preview', selection);
      if (this.current(generation)) this.publish({ preview });
    } catch (error) {
      if (this.current(generation)) this.publish({ error: message(error) });
    } finally {
      if (this.current(generation)) this.publish({ loading: false });
    }
  }
  async confirm() {
    const state = this.state;
    if (!state.active || !state.selection || state.loading || state.attempt?.phase === 'pending')
      return;
    let attempt = state.attempt;
    if (attempt && attempt.phase !== 'unknown') return;
    if (!attempt) {
      if (!state.preview?.ready || !state.preview.token || !state.reviewed) return;
      attempt = {
        phase: 'pending',
        preview: state.preview,
        input: {
          ...state.selection,
          debug: state.preview.debug,
          token: state.preview.token,
          requestId: this.newId(),
          reviewed: true,
        },
      };
    } else attempt = { ...attempt, phase: 'pending', message: undefined };
    const key = context(attempt.input),
      generation = this.generation;
    this.put(key, attempt);
    this.publish({ reviewed: false, error: '' });
    try {
      const result: RunReviewOutcome = await this.request('flow.run.confirm', attempt.input);
      if (result && 'rejected' in result && result.rejected === true) {
        this.put(key, { ...attempt, phase: 'rejected', message: result.message });
        if (this.current(generation)) this.publish({ preview: undefined });
      } else if (
        result &&
        'id' in result &&
        typeof result.id === 'string' &&
        result.flowId === attempt.input.id
      ) {
        this.put(key, { ...attempt, phase: 'created', run: result });
        if (this.current(generation)) await this.open();
      } else throw new Error('没有取得可核对的确认结果，请查询本次请求');
    } catch (error) {
      // A detail failure cannot turn an already-created Run into an unknown confirmation.
      if (this.attempts.get(key)?.phase !== 'created')
        this.put(key, { ...attempt, phase: 'unknown', message: message(error) });
    }
  }
  async open() {
    const attempt = this.state.attempt;
    if (!this.state.active || !attempt?.run || this.state.opening) return;
    const generation = this.generation;
    this.publish({ opening: true, error: '' });
    try {
      const detail = await this.request('run.detail', { id: attempt.run.id });
      if (detail?.run?.id !== attempt.run.id) throw new Error('运行详情与本次编号不一致');
      if (this.current(generation)) this.openDetail(detail);
    } catch (error) {
      if (this.current(generation))
        this.publish({ error: '运行已创建，详情暂未取得：' + message(error) });
    } finally {
      if (this.current(generation)) this.publish({ opening: false });
    }
  }
}
