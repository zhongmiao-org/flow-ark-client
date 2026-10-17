/** Shared admission across legacy conversations, internal trials and persistent threads. */
export class ConversationCapacity {
  private active = new Map<string, string>();
  get full() {
    return this.active.size >= 4;
  }
  acquire(session: string, request: string) {
    if (this.full || this.active.has(session)) throw Error('已有四个会话正在生成，请稍后显式重试');
    this.active.set(session, request);
  }
  release(session: string, request: string) {
    if (this.active.get(session) === request) this.active.delete(session);
  }
}

export function abortable<T>(pending: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    let ended = false;
    const finish = (error: boolean, value: any) => {
      if (ended) return;
      ended = true;
      signal.removeEventListener('abort', cancel);
      error ? reject(value) : resolve(value);
    };
    const cancel = () => finish(true, signal.reason ?? new Error('会话请求已取消'));
    signal.addEventListener('abort', cancel, { once: true });
    try {
      pending().then(
        (v) => finish(false, v),
        (e) => finish(true, e),
      );
    } catch (e) {
      finish(true, e);
    }
  });
}
