import { readdir, readlink, realpath } from 'node:fs/promises';
import { join, resolve, sep, isAbsolute } from 'node:path';
export async function verifyBundle(bundle) {
  const root = await realpath(bundle);
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        const link = await readlink(path);
        const target = await realpath(path);
        if (isAbsolute(link) || !target.startsWith(root + sep))
          throw new Error(`App bundle has an external or absolute link: ${path}`);
      } else if (entry.isDirectory()) await walk(path);
    }
  }
  await walk(root);
}
