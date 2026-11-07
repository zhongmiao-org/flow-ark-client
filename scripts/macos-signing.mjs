import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

// Public certificate fingerprint only. The private key stays in the owner's Keychain.
export const macSigningIdentity = '1B00E55D2A28A571909A6D6791BA357416AC5A57';
export function requireMacSigningIdentity() {
  const identities = execFileSync('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  if (!identities.includes(macSigningIdentity + ' "FlowArk Local Code Signing"'))
    throw new Error('固定 FlowArk 签名证书或私钥不可用；停止打包，不回退 ad-hoc。请在持有原签名私钥的 Mac 上打包。');
}
export function verifyMacSigningIdentity(target) {
  const temporary = mkdtempSync(join(tmpdir(), 'flowark-signature-'));
  try {
    const prefix = join(temporary, 'certificate');
    execFileSync('/usr/bin/codesign', ['--display', '--extract-certificates=' + prefix, target], { stdio: ['ignore', 'ignore', 'pipe'] });
    const fingerprint = createHash('sha1').update(readFileSync(prefix + '0')).digest('hex').toUpperCase();
    if (fingerprint !== macSigningIdentity) throw new Error('签名证书指纹不匹配：' + target);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
