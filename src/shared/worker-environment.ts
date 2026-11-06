/** Trusted workers still must not accidentally inherit unrelated API credentials. */
export function workerEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set(['PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ']);
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) if (allowed.has(key.toUpperCase()) && value !== undefined) result[key] = value;
  result.ELECTRON_RUN_AS_NODE = '1';
  return result;
}
