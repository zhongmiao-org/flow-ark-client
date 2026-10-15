import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SaxesParser, type SaxesTagNS } from 'saxes';
import yauzl from 'yauzl';
import { crc32 } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import type { DocumentBody, DocumentResult } from '../shared/document';
type Warning = DocumentResult['warnings'][number];
export class ExtractionError extends Error {}
const require = createRequire(import.meta.url);
const word = new Set([
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
]);
function body(
  kind: 'page' | 'paragraph' | 'line',
  texts: string[],
  warnings: Warning[],
): DocumentBody {
  const text = texts.join('\n');
  if (texts.length > 1000 || text.length > 50000)
    throw new ExtractionError('资料超过1000单元或50000字符；未截断');
  const units = texts.map((text, i) => ({
    index: i + 1,
    kind,
    locator: `第 ${i + 1} ${kind === 'page' ? '页' : kind === 'paragraph' ? '段' : '行'}`,
    text,
  }));
  const gap = warnings.some((w) =>
    ['empty-unit', 'tracked-changes', 'embedded-content'].includes(w.code),
  );
  return { status: !text.trim() ? 'empty' : gap ? 'partial' : 'ready', text, units, warnings };
}
function decode(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ExtractionError('资料不是有效的UTF-8文本');
  }
}
function xml(
  bytes: Buffer,
  handlers: {
    open?: (tag: SaxesTagNS) => void;
    close?: (tag: SaxesTagNS) => void;
    text?: (value: string) => void;
  },
) {
  let text: string;
  try {
    const encoding =
      (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0)
        ? 'utf-16le'
        : (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0 && bytes[1] === 0x3c)
          ? 'utf-16be'
          : 'utf-8';
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    throw new ExtractionError('DOCX XML编码不支持或损坏');
  }
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(text)) throw new ExtractionError('DOCX不接受DTD或实体声明');
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0,
    count = 0;
  parser.on('doctype', () => {
    throw new ExtractionError('DOCX不接受DTD');
  });
  parser.on('opentag', (tag) => {
    if (++depth > 64 || ++count > 100000) throw new ExtractionError('DOCX XML结构超限');
    handlers.open?.(tag);
  });
  parser.on('closetag', (tag) => {
    handlers.close?.(tag);
    depth--;
  });
  parser.on('text', (value) => handlers.text?.(value));
  parser.on('cdata', (value) => handlers.text?.(value));
  parser.write(text).close();
}
async function docx(bytes: Buffer): Promise<DocumentBody> {
  const parts = await new Promise<Map<string, Buffer>>((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(new ExtractionError('DOCX包损坏或不支持'));
          return;
        }
        const seen = new Set<string>(),
          parts = new Map<string, Buffer>();
        let entries = 0,
          declared = 0,
          actual = 0,
          failed = false;
        const fail = (e: unknown) => {
          if (!failed) {
            failed = true;
            zip.close();
            reject(e);
          }
        };
        zip.on('error', () => fail(new ExtractionError('DOCX ZIP无效')));
        zip.on('entry', (entry) => {
          if (failed) return;
          const name: string = entry.fileName;
          if (
            ++entries > 2000 ||
            seen.has(name) ||
            /[\\\0]/.test(name) ||
            name.startsWith('/') ||
            /^[A-Za-z]:/.test(name) ||
            name.split('/').some((p) => p === '.' || p === '..') ||
            entry.generalPurposeBitFlag & 1
          ) {
            fail(new ExtractionError('DOCX条目数量、路径、身份或加密不受支持'));
            return;
          }
          seen.add(name);
          declared += entry.uncompressedSize;
          if (
            declared > 32 * 1024 * 1024 ||
            (name === 'word/document.xml' && entry.uncompressedSize > 8 * 1024 * 1024) ||
            /vbaProject\.bin$/i.test(name)
          ) {
            fail(new ExtractionError('DOCX展开超限或含宏'));
            return;
          }
          if (name.endsWith('/')) {
            zip.readEntry();
            return;
          }
          // Drain all entries under a total budget to check actual expanded sizes; retain only required XML.
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) {
              fail(new ExtractionError('DOCX条目不可读'));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0,
              checksum = 0;
            const keep = ['[Content_Types].xml', 'word/document.xml'].includes(name);
            stream.on('data', (chunk: Buffer) => {
              actual += chunk.length;
              size += chunk.length;
              checksum = crc32(chunk, checksum);
              if (actual > 32 * 1024 * 1024 || (keep && size > 8 * 1024 * 1024)) {
                stream.destroy();
                fail(new ExtractionError('DOCX实际展开超限'));
                return;
              }
              if (keep) chunks.push(chunk);
            });
            stream.on('error', () => fail(new ExtractionError('DOCX条目数据无效')));
            stream.on('end', () => {
              if (failed) return;
              if (size !== entry.uncompressedSize || checksum !== entry.crc32) {
                fail(new ExtractionError('DOCX条目大小或校验不一致'));
                return;
              }
              if (keep) parts.set(name, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });
        zip.on('end', () => {
          if (!failed) {
            parts.set(
              '_embedded',
              Buffer.from([...seen].some((n) => n.startsWith('word/embeddings/')) ? '1' : '0'),
            );
            resolve(parts);
          }
        });
        zip.readEntry();
      },
    );
  });
  const document = parts.get('word/document.xml'),
    types = parts.get('[Content_Types].xml');
  if (!document || !types) throw new ExtractionError('DOCX缺少主文档或内容声明');
  let main = false;
  xml(types, {
    open: (tag) => {
      if (
        tag.local === 'Override' &&
        Object.values(tag.attributes).some(
          (a) => a.local === 'PartName' && a.value === '/word/document.xml',
        ) &&
        Object.values(tag.attributes).some(
          (a) =>
            a.local === 'ContentType' &&
            a.value ===
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        )
      )
        main = true;
    },
  });
  if (!main) throw new ExtractionError('DOCX主文档格式不支持');
  const texts: string[] = [],
    stack: { name: string; uri: string }[] = [];
  let paragraph: string | undefined,
    sawBody = false,
    tracked = false,
    embedded = parts.get('_embedded')?.toString() === '1';
  xml(document, {
    open: (tag) => {
      stack.push({ name: tag.local, uri: tag.uri });
      if (stack.length === 1 && (!word.has(tag.uri) || tag.local !== 'document'))
        throw new ExtractionError('DOCX根结构不支持');
      if (!word.has(tag.uri)) return;
      if (tag.local === 'body') {
        if (stack.length !== 2 || sawBody) throw new ExtractionError('DOCX正文结构不支持');
        sawBody = true;
      }
      if (['ins', 'del', 'moveFrom', 'moveTo'].includes(tag.local)) tracked = true;
      if (['object', 'drawing', 'pict', 'altChunk'].includes(tag.local)) embedded = true;
      const skipped = stack.some(
        (t) => word.has(t.uri) && ['del', 'moveFrom', 'txbxContent'].includes(t.name),
      );
      if (!stack.some((t) => word.has(t.uri) && t.name === 'body') || skipped) return;
      if (tag.local === 'p') {
        if (paragraph !== undefined) throw new ExtractionError('DOCX嵌套段落不支持');
        paragraph = '';
      }
      if (paragraph !== undefined && tag.local === 'tab') paragraph += '\t';
      if (paragraph !== undefined && ['br', 'cr'].includes(tag.local)) paragraph += '\n';
    },
    text: (value: string) => {
      const last = stack.at(-1);
      if (
        paragraph !== undefined &&
        last?.name === 't' &&
        word.has(last.uri) &&
        !stack.some((t) => word.has(t.uri) && ['del', 'moveFrom', 'txbxContent'].includes(t.name))
      ) {
        paragraph += value;
        if (paragraph.length + texts.reduce((n, s) => n + s.length + 1, 0) > 50000)
          throw new ExtractionError('DOCX正文超过50000字符');
      }
    },
    close: (tag) => {
      if (
        word.has(tag.uri) &&
        tag.local === 'p' &&
        paragraph !== undefined &&
        !stack.some((t) => word.has(t.uri) && ['del', 'moveFrom', 'txbxContent'].includes(t.name))
      ) {
        texts.push(paragraph);
        paragraph = undefined;
        if (texts.length > 1000) throw new ExtractionError('DOCX超过1000段');
      }
      stack.pop();
    },
  });
  if (!sawBody) throw new ExtractionError('DOCX正文结构不支持');
  const warnings: Warning[] = [
    {
      code: 'body-only',
      unit: null,
      message: '仅主文档正文，含表格内段落；不含页眉页脚、批注、脚注或原排版。',
    },
  ];
  if (tracked)
    warnings.push({
      code: 'tracked-changes',
      unit: null,
      message: '存在修订标记，删除内容未采用；请核对当前正文。',
    });
  if (embedded)
    warnings.push({
      code: 'embedded-content',
      unit: null,
      message: '含图片或嵌入内容，未识别或展开；请核对缺口。',
    });
  return body('paragraph', texts, warnings);
}
export async function parseDocument(
  format: 'text' | 'pdf' | 'docx',
  bytes: Buffer,
): Promise<DocumentBody> {
  if (bytes.length > 8 * 1024 * 1024) throw new ExtractionError('资料超过8MiB');
  if (format === 'text') {
    const text = decode(bytes).replace(/\r\n?/g, '\n');
    if (
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) ||
      text.startsWith('%PDF-') ||
      bytes.subarray(0, 2).toString() === 'PK'
    )
      throw new ExtractionError('文本含二进制内容或格式不匹配');
    return body('line', text.split('\n'), []);
  }
  if (format === 'docx') {
    if (bytes.subarray(0, 2).toString() !== 'PK') throw new ExtractionError('DOCX格式不匹配');
    return docx(bytes);
  }
  if (bytes.subarray(0, 5).toString() !== '%PDF-') throw new ExtractionError('PDF格式不匹配');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    join(root, 'legacy/build/pdf.worker.mjs'),
  ).href;
  let resourceFailed = false;
  class BundledData {
    async fetch({ kind, filename }: { kind: string; filename: string }) {
      try {
        const folder =
          kind === 'cMapUrl'
            ? 'cmaps'
            : kind === 'standardFontDataUrl'
              ? 'standard_fonts'
              : undefined;
        if (!folder || !/^[A-Za-z0-9_.-]{1,150}$/.test(filename) || filename.includes('..'))
          throw new ExtractionError('PDF资源名称不支持');
        return new Uint8Array(await readFile(join(root, folder, filename)));
      } catch {
        resourceFailed = true;
        throw new ExtractionError('PDF所需本机字体或映射不可读取');
      }
    }
  }
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    BinaryDataFactory: BundledData,
    cMapUrl: join(root, 'cmaps') + sep,
    cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + sep,
    useWorkerFetch: false,
    useSystemFonts: false,
    useWasm: false,
    disableFontFace: true,
    stopAtErrors: true,
    isOffscreenCanvasSupported: false,
    verbosity: 0,
  });
  let passwordReject!: (e: Error) => void;
  const password = new Promise<never>((_, reject) => {
    passwordReject = reject;
  });
  task.onPassword = () => {
    passwordReject(new ExtractionError('PDF需要密码，未请求或保存密码'));
  };
  try {
    const pdf = await Promise.race([task.promise, password]);
    if (pdf.isPureXfa) throw new ExtractionError('PDF表单格式暂不支持');
    if (pdf.numPages > 100) throw new ExtractionError('PDF超过100页；未截断');
    const texts: string[] = [],
      warnings: Warning[] = [
        { code: 'text-only', unit: null, message: '仅提取可读取文字，不识别图片或保留原排版。' },
      ];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i),
        content = await page.getTextContent();
      if (resourceFailed)
        throw new ExtractionError('PDF所需本机字体或映射不可读取，未采用部分正文');
      let text = '';
      for (const item of content.items)
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      text = text.trimEnd();
      texts.push(text);
      if (texts.reduce((n, t) => n + t.length, 0) + texts.length - 1 > 50000)
        throw new ExtractionError('PDF正文超过50000字符；未截断');
      if (!text.trim())
        warnings.push({
          code: 'empty-unit',
          unit: i,
          message: '本页没有可提取文字，可能为空白或扫描内容，请人工核对。',
        });
      page.cleanup();
    }
    return body('page', texts, warnings);
  } catch (e) {
    if ((e as Error).name === 'PasswordException')
      throw new ExtractionError('PDF需要密码，未请求或保存密码');
    throw e;
  } finally {
    await task.destroy();
  }
}
