import fs from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_CREATED_NAMES, numberedFilename } from '../shared/file-create';

/** The caller resolves the authorized parent, without following the output leaf. */
export async function createText(
  path: string,
  content: string,
  numbered: boolean,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const temporary = join(dirname(path), '.flowark-' + randomUUID() + '.tmp');
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    signal?.throwIfAborted();
    await handle.writeFile(content, 'utf8');
    for (let index = 0; index < (numbered ? MAX_CREATED_NAMES : 1); index++) {
      signal?.throwIfAborted();
      const candidate = join(dirname(path), numberedFilename(basename(path), index));
      try {
        await fs.link(temporary, candidate);
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!numbered) throw new Error('输出文件已存在，请更换文件名；原文件未覆盖');
      }
    }
    throw new Error('原文件名及 999 个序号均已占用，请更换名称；已有文件未覆盖');
  } finally {
    try {
      await handle.close();
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}
