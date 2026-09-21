import { _electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { killOwnedTree } from '../src/host/processes.ts';

export function desktopMains(output) {
  return output
    .split('\n')
    .filter((line) =>
      /^\s*\d+\s+\/.*\/(?:FlowArk|Electron)\.app\/Contents\/MacOS\/(?:FlowArk|Electron)\s*$/.test(
        line,
      ),
    );
}

export function readDesktopMains() {
  if (process.platform !== 'darwin')
    throw new Error('Desktop smoke preflight currently supports macOS only');
  // comm contains the executable, without shell arguments that merely mention it.
  return desktopMains(execFileSync('/bin/ps', ['-axo', 'pid=,comm='], { encoding: 'utf8' }));
}

// Shared by all checkouts for this OS user. An abandoned lock is deliberately
// not stolen: inspect the recorded owner and desktop processes before removing it.
export function desktopLock(directory = join(tmpdir(), 'flowark-desktop-smoke.lock')) {
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        `Another desktop test owns ${directory}; verify its process has exited before retrying`,
      );
    throw error;
  }
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  const file = join(directory, 'owner.json');
  try {
    writeFileSync(file, owner, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    if (readFileSync(file, 'utf8') !== owner)
      throw new Error('Desktop test lock ownership changed');
    rmSync(directory, { recursive: true });
    released = true;
  };
}

const exited = (child) => child.exitCode !== null || child.signalCode !== null;
async function deadline(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function waitForExit(child, milliseconds) {
  if (exited(child)) return;
  let onExit;
  try {
    await deadline(
      new Promise((resolve) => {
        onExit = resolve;
        child.once('exit', onExit);
      }),
      milliseconds,
      'Owned desktop main did not exit',
    );
  } finally {
    child.off('exit', onExit);
  }
}

export function createDesktopLauncher({
  launch = (options) => _electron.launch(options),
  list = readDesktopMains,
  lock = desktopLock,
  terminate = killOwnedTree,
  failed = () => {
    process.exitCode = 1;
  },
  closeTimeout = 15000,
  exitTimeout = 5000,
} = {}) {
  let busy = false;
  let cleanupFailed = false;
  return {
    async launch(options) {
      if (busy || cleanupFailed)
        throw new Error('Previous desktop session must finish before another launch');
      busy = true;
      let release, child;
      let launchAttempted = false;
      let released = false;
      const finish = () => {
        if (released) return;
        release?.();
        released = true;
        busy = false;
        process.off('exit', onParentExit);
      };
      const onParentExit = () => {
        if (child && exited(child)) finish();
      };
      try {
        release = lock();
        const existing = list();
        if (existing.length)
          throw new Error(
            `Existing desktop main must exit before testing:\n${existing.join('\n')}`,
          );
        process.once('exit', onParentExit);
        launchAttempted = true;
        const application = await launch(options);
        child = application.process(); // Cache immediately; Playwright may discard it after close.
        application.process = () => child;
        const close = application.close.bind(application);
        let closing;
        application.close = () =>
          (closing ??= (async () => {
            try {
              if (!exited(child))
                await deadline(
                  close(),
                  closeTimeout,
                  'Desktop close timed out; a pending quit confirmation may be blocking it',
                );
              await waitForExit(child, exitTimeout);
            } catch (error) {
              cleanupFailed = true;
              failed();
              await deadline(terminate(child), exitTimeout, 'Owned desktop cleanup timed out');
              await waitForExit(child, exitTimeout);
              throw error; // Forced cleanup must never count as a passing smoke test.
            } finally {
              if (exited(child)) finish();
            }
          })());
        child.once('exit', finish);
        if (exited(child)) finish();
        return application;
      } catch (error) {
        // Launch failure ownership remains with Playwright. Never kill an app
        // found in ps. Hold the lock if absence cannot be established.
        if (!release) busy = false;
        else if (!launchAttempted) finish();
        else {
          try {
            if (!list().length) finish();
          } catch {
            cleanupFailed = true;
          }
        }
        throw error;
      }
    },
  };
}

export const desktopElectron = createDesktopLauncher();
