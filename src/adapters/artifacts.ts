import { createHash } from 'node:crypto';
import { constants, createWriteStream, type BigIntStats } from 'node:fs';
import { access, mkdir, open, realpath, rmdir, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type ArtifactFile = {
  path: string;
  storage?: 'snapshot-v1';
  sha256?: string;
};
type Integrity = 'verified' | 'changed' | 'missing' | 'unverified';
const signature = (s: BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(':');

/** Owns history copies; business output paths remain available to subsequent steps. */
export class ArtifactFiles {
  private cache = new Map<string, { signature: string; sha256: string }>();
  constructor(private root: string) {}

  async capture(runId: string, artifactId: string, source: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (![runId, artifactId].every((id) => /^[\w-]+$/.test(id))) throw new Error('产物标识无效');
    const actual = await realpath(source);
    const before = await stat(actual, { bigint: true });
    if (!before.isFile()) throw new Error('产物来源必须是普通文件');
    const directory = join(this.root, 'artifacts', runId, artifactId);
    await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
    // Exclusive directory creation prevents cleanup from touching an earlier registration.
    await mkdir(directory, { mode: 0o700 });
    const target = join(directory, basename(actual));
    try {
      const input = await open(actual, 'r');
      const hash = createHash('sha256');
      let size = 0;
      try {
        if (signature(await input.stat({ bigint: true })) !== signature(before))
          throw new Error('产物来源在保存副本期间发生变化');
        await pipeline(
          input.createReadStream({ autoClose: false }),
          new Transform({
            transform(chunk, _encoding, done) {
              hash.update(chunk);
              size += chunk.length;
              done(null, chunk);
            },
          }),
          createWriteStream(target, { flags: 'wx', mode: 0o600 }),
          { signal },
        );
        if (
          signature(await input.stat({ bigint: true })) !== signature(before) ||
          signature(await stat(actual, { bigint: true })) !== signature(before) ||
          BigInt(size) !== before.size
        )
          throw new Error('产物来源在保存副本期间发生变化');
      } finally {
        await input.close();
      }
      signal.throwIfAborted();
      return {
        path: await realpath(target),
        name: basename(actual),
        size,
        storage: 'snapshot-v1' as const,
        sha256: hash.digest('hex'),
      };
    } catch (error) {
      await this.discard({ path: target });
      throw error;
    }
  }

  /** Only called for an unpublished copy created by capture. Never removes the source. */
  async discard(item: ArtifactFile) {
    this.cache.delete(item.path);
    await unlink(item.path).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await rmdir(dirname(item.path));
  }

  async inspect(
    item: ArtifactFile,
    force = false,
  ): Promise<{ available: boolean; integrity: Integrity }> {
    let integrity: Integrity = 'missing';
    try {
      if ((await realpath(item.path)) !== item.path) return { available: false, integrity };
      const before = await stat(item.path, { bigint: true });
      if (!before.isFile()) return { available: false, integrity };
      await access(item.path, constants.R_OK);
      if (!item.storage && !item.sha256) return { available: true, integrity: 'unverified' };
      if (item.storage !== 'snapshot-v1' || !/^[a-f0-9]{64}$/.test(item.sha256 ?? ''))
        return { available: false, integrity: 'changed' };
      const key = signature(before);
      let cached = this.cache.get(item.path);
      if (force || cached?.signature !== key) {
        const input = await open(item.path, 'r');
        const hash = createHash('sha256');
        try {
          if (signature(await input.stat({ bigint: true })) !== key)
            return { available: false, integrity };
          for await (const chunk of input.createReadStream({ autoClose: false }))
            hash.update(chunk);
          if (
            signature(await input.stat({ bigint: true })) !== key ||
            signature(await stat(item.path, { bigint: true })) !== key ||
            (await realpath(item.path)) !== item.path
          )
            return { available: false, integrity };
        } finally {
          await input.close();
        }
        cached = { signature: key, sha256: hash.digest('hex') };
        if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(item.path, cached);
      }
      integrity = cached!.sha256 === item.sha256 ? 'verified' : 'changed';
    } catch {
      this.cache.delete(item.path);
    }
    return { available: integrity === 'verified', integrity };
  }
}
