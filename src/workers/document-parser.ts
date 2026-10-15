import { parseDocument, ExtractionError } from '../documents/extract';
let used = false;
globalThis.fetch = async () => {
  throw new ExtractionError('资料解析不允许读取远程资源');
};
process.on('disconnect', () => process.exit(1));
process.on('message', async (message: any) => {
  if (used) return;
  used = true;
  try {
    if (
      !message ||
      !['text', 'pdf', 'docx'].includes(message.format) ||
      typeof message.data !== 'string' ||
      message.data.length > 12 * 1024 * 1024 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data) ||
      Buffer.from(message.data, 'base64').toString('base64') !== message.data
    )
      throw new ExtractionError('资料解析输入无效');
    const result = await parseDocument(message.format, Buffer.from(message.data, 'base64'));
    if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024)
      throw new Error('资料解析结果超过1MiB');
    process.send?.({ result });
  } catch (e) {
    process.send?.({
      error:
        e instanceof ExtractionError
          ? e.message.slice(0, 600)
          : '资料解析失败，格式损坏或内容暂不受支持',
    });
  }
});
