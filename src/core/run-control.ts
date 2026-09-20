type Location = { nodeInstance: string; nodeName: string };

// One gate per execution. Register the waiter before publishing PAUSED so a fast
// user response cannot arrive between the state notification and waiter setup.
export class RunControl {
  private continuous: boolean;
  private permit = false;
  private waiting?: () => void;
  constructor(
    debug: boolean,
    private signal: AbortSignal,
    private publish: (state: string, data?: Location | { message: string }) => Promise<unknown>,
  ) {
    this.continuous = !debug;
  }
  control(action: 'pause' | 'resume' | 'step') {
    if (action === 'pause') {
      this.continuous = false;
      this.permit = false;
    } else {
      this.continuous = action === 'resume';
      this.permit = action === 'step';
      this.waiting?.();
    }
  }
  async boundary(location: Location, signal = this.signal) {
    this.signal.throwIfAborted();
    signal.throwIfAborted();
    if (!this.continuous && !this.permit) await this.wait('PAUSED', location, signal);
    this.signal.throwIfAborted();
    signal.throwIfAborted();
    this.permit = false;
  }
  async human(message: string, signal = this.signal) {
    await this.wait('WAITING_INPUT', { message }, signal);
    return { confirmed: true };
  }
  private async wait(state: string, data: Location | { message: string }, signal: AbortSignal) {
    this.signal.throwIfAborted();
    signal.throwIfAborted();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.waiting = release;
    const signals = [...new Set([this.signal, signal])];
    let aborted!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      aborted = () => reject(this.signal.aborted ? this.signal.reason : signal.reason);
      for (const source of signals) source.addEventListener('abort', aborted, { once: true });
    });
    try {
      await Promise.race([this.publish(state, data), interrupted]);
      await Promise.race([waiting, interrupted]);
      this.signal.throwIfAborted();
      signal.throwIfAborted();
      await Promise.race([this.publish('RUNNING'), interrupted]);
      this.signal.throwIfAborted();
      signal.throwIfAborted();
    } finally {
      for (const source of signals) source.removeEventListener('abort', aborted);
      if (this.waiting === release) this.waiting = undefined;
    }
  }
}
