import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const authoringSkill = { id: 'flowark-project-author', version: '1.2.21-draft', uri: 'flowark://skills/flowark-project-author/SKILL.md' } as const;
export async function readAuthoringSkill() {
  const path = typeof __dirname === 'string' ? join(__dirname, 'skills', authoringSkill.id, 'SKILL.md') : fileURLToPath(new URL('../../resources/skills/flowark-project-author/SKILL.md', import.meta.url));
  return { ...authoringSkill, content: await readFile(path, 'utf8') };
}
