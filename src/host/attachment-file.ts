import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { IMAGE_MAX_BYTES, TEXT_EXTENSIONS } from '../shared/task-attachments';

export function imageInfo(bytes: Buffer): {
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
} {
  let width = 0,
    height = 0;
  let mimeType: 'image/png' | 'image/jpeg';
  if (
    bytes.length >= 33 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    bytes.toString('ascii', 12, 16) === 'IHDR' &&
    bytes.readUInt32BE(8) === 13
  ) {
    mimeType = 'image/png';
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = 'image/jpeg';
    let p = 2;
    while (p + 3 < bytes.length) {
      if (bytes[p++] !== 0xff) throw new Error('JPEG 数据无效');
      while (bytes[p] === 0xff) p++;
      const marker = bytes[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (p + 2 > bytes.length) break;
      const size = bytes.readUInt16BE(p);
      if (size < 2 || p + size > bytes.length) throw new Error('JPEG 数据不完整');
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8) throw new Error('JPEG 尺寸无效');
        height = bytes.readUInt16BE(p + 3);
        width = bytes.readUInt16BE(p + 5);
        break;
      }
      p += size;
    }
  } else throw new Error('请选择有效的 PNG 或 JPEG 图片');
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16000000)
    throw new Error('图片尺寸超过限制或无效（每边 8192 像素、总计 1600 万像素）');
  if (bytes.length > IMAGE_MAX_BYTES) throw new Error('图片超过 4 MiB');
  return { mimeType, width, height };
}
export const attachmentHash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function decodeAttachmentText(bytes: Buffer) {
  if (bytes.length > 200 * 1024) throw new Error('文本文件超过 200 KiB');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('文件不是有效的 UTF-8 文本');
  }
  if (text.length > 50000) throw new Error('文本超过 50000 字符');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
    throw new Error('文件含有二进制控制内容');
  return text;
}
export async function readAttachmentFile(path: string, kind: 'file' | 'image') {
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096)
    throw new Error('文件选择结果无效');
  const name = basename(path),
    extension = extname(name).slice(1).toLowerCase();
  if (!name || name.length > 200) throw new Error('文件名最多 200 字符');
  const isImage = ['png', 'jpg', 'jpeg'].includes(extension);
  if ((kind === 'image' && !isImage) || (!isImage && !TEXT_EXTENSIONS.includes(extension)))
    throw new Error('支持 UTF-8 文本、PNG 和 JPEG；此文件格式暂不支持');
  const max = isImage ? IMAGE_MAX_BYTES : 200 * 1024;
  // O_NONBLOCK also ensures a selected FIFO cannot stall the host before fstat.
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile()) throw new Error('附件必须是普通文件');
    if (before.size > BigInt(max))
      throw new Error(isImage ? '图片超过 4 MiB' : '文本文件超过 200 KiB');
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const part = await file.read(bytes, length, bytes.length - length, length);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (
      length !== Number(before.size) ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.dev !== after.dev ||
      before.ino !== after.ino
    )
      throw new Error('读取期间文件已变化，请重新选择');
    const body = bytes.subarray(0, length);
    return isImage
      ? {
          name,
          kind: 'image' as const,
          ...imageInfo(body),
          size: length,
          sha256: attachmentHash(body),
          body: body.toString('base64'),
        }
      : {
          name,
          kind: 'text' as const,
          mimeType: 'text/plain' as const,
          size: length,
          sha256: attachmentHash(body),
          body: decodeAttachmentText(body),
        };
  } finally {
    await file.close();
  }
}
