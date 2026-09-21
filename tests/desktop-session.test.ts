import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopLauncher, desktopLock, desktopMains } from '../scripts/desktop-session.mjs';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null,
    pid: 999,
  });
  let reads = 0;
  const exit = () => {
    child.exitCode = 0;
    child.emit('exit', 0, null);
  };
  const application = {
    process: () => {
      reads++;
      return child;
    },
    close: async () => {
      exit();
    },
  };
  return { child, application, exit, reads: () => reads };
}

test('desktop preflight counts main apps and excludes helpers or command mentions', () => {
  const main = ' 42 /Users/mac/Applications/FlowArk.app/Contents/MacOS/FlowArk';
  const development =
    ' 45 /project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
  assert.deepEqual(
    desktopMains(
      [
        main,
        development,
        ' 43 /Applications/FlowArk.app/Contents/Frameworks/FlowArk Helper.app/Contents/MacOS/FlowArk Helper --type=renderer',
        ' 44 /bin/zsh',
        ' 46 /Applications/Electron.app/Contents/MacOS/Electron Helper',
        ' 47 /Applications/Codex.app/Contents/MacOS/Codex',
      ].join('\n'),
    ),
    [main, development],
  );
});

test('desktop lock excludes a second owner and releases only its own lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'flowark-desktop-lock-check-'));
  try {
    const path = join(root, 'lock');
    const release = desktopLock(path);
    assert.throws(() => desktopLock(path), /Another desktop test owns/);
    release();
    const next = desktopLock(path);
    release(); // An old owner cannot release the replacement lock.
    assert.throws(() => desktopLock(path), /Another desktop test owns/);
    next();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('existing main or unavailable process inspection blocks launch without holding the lease', async () => {
  let launched = 0,
    released = 0;
  for (const list of [
    () => [' 123 /Applications/FlowArk.app/Contents/MacOS/FlowArk'],
    () => {
      throw new Error('ps unavailable');
    },
  ]) {
    const guard = createDesktopLauncher({
      list,
      lock: () => () => {
        released++;
      },
      launch: async () => {
        launched++;
        throw new Error('must not launch');
      },
    });
    await assert.rejects(guard.launch({}), /Existing desktop main|ps unavailable/);
  }
  assert.equal(launched, 0);
  assert.equal(released, 2);
});

test('pending launches are serialized and close waits for actual process exit', async () => {
  const f = fixture();
  let unlock!: () => void,
    released = 0,
    closed = 0;
  f.application.close = async () => {
    closed++;
    setTimeout(f.exit, 35);
  };
  const guard = createDesktopLauncher({
    list: () => [],
    lock: () => () => {
      released++;
    },
    launch: async () => {
      await new Promise<void>((r) => {
        unlock = r;
      });
      return f.application as any;
    },
  });
  const pending = guard.launch({});
  await assert.rejects(guard.launch({}), /Previous desktop session/);
  unlock();
  const app = await pending;
  assert.equal(app.process(), f.child);
  assert.equal(f.reads(), 1);
  const closing = app.close();
  await pause(5);
  assert.equal(f.child.exitCode, null);
  await assert.rejects(guard.launch({}), /Previous desktop session/);
  await closing;
  await app.close();
  assert.equal(closed, 1);
  assert.equal(released, 1);
  assert.equal(f.child.exitCode, 0);
});

test('failed launch releases its lease only after absence is established', async () => {
  let released = 0,
    calls = 0;
  const guard = createDesktopLauncher({
    list: () => {
      calls++;
      return [];
    },
    lock: () => () => {
      released++;
    },
    launch: async () => {
      throw new Error('launch failed');
    },
  });
  await assert.rejects(guard.launch({}), /launch failed/);
  assert.equal(released, 1);
  assert.equal(calls, 2);
});

test('blocked close reaps only the owned process and fails the test instead of launching again', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  let failure = 0,
    released = 0;
  const guard = createDesktopLauncher({
    list: () => [],
    lock: () => () => {
      released++;
    },
    closeTimeout: 25,
    exitTimeout: 2000,
    launch: async () => ({ process: () => child, close: () => new Promise(() => {}) }) as any,
    failed: () => {
      failure++;
    },
    terminate: async (owned) => {
      assert.equal(owned, child);
      owned.kill('SIGKILL');
    },
  });
  try {
    const app = await guard.launch({});
    await assert.rejects(app.close(), /Desktop close timed out/);
    assert.equal(child.signalCode, 'SIGKILL');
    assert.equal(failure, 1);
    assert.equal(released, 1);
    await assert.rejects(guard.launch({}), /Previous desktop session/);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
});

test('desktop scripts cannot import an unguarded Electron launcher', async () => {
  async function walk(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      ),
    );
    return files.flat();
  }
  for (const file of await walk('scripts')) {
    if (!/\.(?:mjs|ts)$/.test(file) || file.endsWith('desktop-session.mjs')) continue;
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /import\s*\{[^}]*\b_electron\b[^}]*\}\s*from\s*['"]playwright-core['"]/,
      file,
    );
  }
});
