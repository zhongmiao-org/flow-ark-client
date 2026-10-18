import type { BrowserFieldsResult } from '../shared/contracts.generated';

/** Serialized into a selected browser document. Keep synchronous and closure-free. */
export type BrowserFieldsDOMInput = {
  selector: string;
  framePath: string[];
  url: string;
  fields: {
    key: string;
    selector: string;
    operation: 'text' | 'attribute';
    attribute: string | null;
    required: boolean;
  }[];
};
export function readBrowserFields(input: BrowserFieldsDOMInput): BrowserFieldsResult {
  const roots = document.querySelectorAll(input.selector);
  if (roots.length !== 1) throw Error('采集根元素须唯一匹配，实际匹配 ' + roots.length + ' 项');
  const encoder = new TextEncoder();
  const check = (value: string, bytes: number) => {
    const encoded = encoder.encode(value);
    if (new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(encoded) !== value)
      throw Error('关联字段含无效Unicode');
    if (encoded.length > bytes) throw Error('关联字段结果超限，整次采集未采用');
  };
  const fields = input.fields.map((f) => {
    const matches = roots[0].querySelectorAll(f.selector);
    const count = matches.length;
    const value =
      count !== 1
        ? null
        : f.operation === 'text'
          ? (matches[0].textContent ?? '')
          : matches[0].getAttribute(f.attribute!);
    if (value !== null) check(value, 8192);
    const status =
      count === 0
        ? 'missing'
        : count > 1
          ? 'ambiguous'
          : value === null
            ? 'missing-attribute'
            : value.trim() === ''
              ? 'empty'
              : 'ok';
    return { ...f, count, status, value };
  });
  const result = {
    version: 1,
    operation: 'collect',
    url: input.url,
    documentUrl: location.href,
    selector: input.selector,
    framePath: input.framePath,
    complete: fields.every((f) => f.status !== 'ambiguous' && (!f.required || f.status === 'ok')),
    fields,
  } as BrowserFieldsResult;
  check(result.url, 16384);
  check(result.documentUrl, 16384);
  check(JSON.stringify(result), 65536);
  return result;
}
