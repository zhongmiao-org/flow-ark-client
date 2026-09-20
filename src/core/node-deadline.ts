class NodeTimeoutError extends Error {
  constructor(
    readonly deadlineAt: number,
    instance: string,
    timeoutMs: number,
  ) {
    super(`节点超时：${instance}（${timeoutMs} 毫秒）`);
  }
}
type Deadline = { at: number; error: NodeTimeoutError };

/** A disposable execution scope. Deadlines use monotonic time, including after CPU work. */
export class NodeDeadline {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly rootSignal: AbortSignal;
  private readonly parentSignal: AbortSignal;
  private readonly deadline?: Deadline;
  private timer?: ReturnType<typeof setTimeout>;
  private readonly parentAborted = () => {
    this.controller.abort(this.reason() ?? this.parentSignal.reason);
  };

  constructor(parent: NodeDeadline | AbortSignal, instance?: string, timeoutMs?: number) {
    this.rootSignal = parent instanceof NodeDeadline ? parent.rootSignal : parent;
    this.parentSignal = parent instanceof NodeDeadline ? parent.signal : parent;
    const inherited = parent instanceof NodeDeadline ? parent.deadline : undefined;
    const at = timeoutMs === undefined ? undefined : performance.now() + timeoutMs;
    const own =
      at === undefined
        ? undefined
        : {
            at,
            error: new NodeTimeoutError(at, instance!, timeoutMs!),
          };
    this.deadline = inherited && (!own || inherited.at <= own.at) ? inherited : own;
    this.parentSignal.addEventListener('abort', this.parentAborted, { once: true });
    if (this.parentSignal.aborted) this.parentAborted();
    if (this.deadline && !this.signal.aborted) this.armTimer();
  }

  private reason(): unknown {
    if (this.rootSignal.aborted) return this.rootSignal.reason;
    if (this.deadline && performance.now() >= this.deadline.at) return this.deadline.error;
    if (this.parentSignal.aborted) return this.parentSignal.reason;
    if (this.signal.aborted) return this.signal.reason;
    return undefined;
  }

  private armTimer() {
    this.timer = setTimeout(
      () => {
        const reason = this.reason();
        if (reason !== undefined) this.controller.abort(reason);
        else this.armTimer(); // A timer may wake slightly before the monotonic deadline.
      },
      Math.max(1, Math.ceil(this.deadline!.at - performance.now())),
    );
  }

  check() {
    const reason = this.reason();
    if (reason !== undefined) {
      this.controller.abort(reason);
      throw reason;
    }
  }

  async run<T>(work: () => Promise<T> | T): Promise<T> {
    this.check();
    let onAbort!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(this.reason() ?? this.signal.reason);
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const pending = Promise.resolve().then(() => {
        this.check();
        return work();
      });
      const result = await Promise.race([pending, interrupted]);
      this.check();
      return result;
    } catch (error) {
      // A late timer/check in an ancestor must not replace an earlier child deadline.
      // User cancellation remains authoritative even when both deadlines have passed.
      if (this.rootSignal.aborted) this.check();
      const reason = this.reason();
      if (
        error instanceof NodeTimeoutError &&
        (!(reason instanceof NodeTimeoutError) || error.deadlineAt <= reason.deadlineAt)
      )
        throw error;
      this.check();
      throw error;
    } finally {
      this.signal.removeEventListener('abort', onAbort);
    }
  }

  dispose() {
    clearTimeout(this.timer);
    this.parentSignal.removeEventListener('abort', this.parentAborted);
  }
}
