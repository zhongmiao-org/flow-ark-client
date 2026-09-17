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
  async boundary(location: Location) {
    this.signal.throwIfAborted();
    if (!this.continuous && !this.permit) await this.wait('PAUSED', location);
    this.signal.throwIfAborted();
    this.permit = false;
  }
  async human(message: string) {
    await this.wait('WAITING_INPUT', { message });
    return { confirmed: true };
  }
  private async wait(state: string, data: Location | { message: string }) {
    this.signal.throwIfAborted();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.waiting = release;
    const aborted = () => release();
    this.signal.addEventListener('abort', aborted, { once: true });
    try {
      await this.publish(state, data);
      await waiting;
      this.signal.throwIfAborted();
      await this.publish('RUNNING');
    } finally {
      this.signal.removeEventListener('abort', aborted);
      if (this.waiting === release) this.waiting = undefined;
    }
  }
}
