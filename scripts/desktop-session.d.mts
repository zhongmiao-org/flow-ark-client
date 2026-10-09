import type { ChildProcess } from 'node:child_process';
import type { _electron } from 'playwright-core';
export function desktopMains(output: string): string[];
export function readDesktopMains(): string[];
export function desktopLock(directory?: string): () => void;
export function createDesktopLauncher(options?: {
  launch?: typeof _electron.launch;
  list?: () => string[];
  lock?: () => () => void;
  terminate?: (child: ChildProcess) => Promise<void>;
  failed?: () => void;
  closeTimeout?: number;
  exitTimeout?: number;
}): Pick<typeof _electron, 'launch'>;
export const desktopElectron: Pick<typeof _electron, 'launch'>;
