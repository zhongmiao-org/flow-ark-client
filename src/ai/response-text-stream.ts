type TextPart = { text: string; done: boolean };
type OutputItem = { id: string; type: 'message' | 'reasoning'; done: boolean; parts: TextPart[] };
const identity = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 200 &&
  value.trim() === value &&
  !/[\u0000-\u001f\u007f]/.test(value);
const index = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export function requireStreamIdentity(value: unknown): string {
  if (!identity(value)) throw Error('AI 消息流缺少有效响应身份');
  return value;
}

/** Tracks the one HTTP response and its ordered text paths before anything becomes complete. */
export class ResponseTextStream {
  private responseId = '';
  private items: OutputItem[] = [];
  private collected = 0;
  private outputCursor = 0;
  private partCursor = 0;
  private partOffset = 0;
  constructor(private append: (part: string) => void) {}
  accept(event: any): boolean {
    if (event.type === 'response.created') {
      if (this.responseId || !identity(event.response?.id))
        throw Error('AI 响应创建身份缺失或重复');
      this.responseId = event.response.id;
    }
    if (!this.responseId) throw Error('AI 消息流缺少响应创建身份');
    if (
      (event.response !== undefined && event.response?.id !== this.responseId) ||
      (event.response_id !== undefined && event.response_id !== this.responseId)
    )
      throw Error('AI 消息流的响应身份不一致');
    if (event.type === 'response.output_item.added') {
      const item = event.item;
      if (
        event.output_index !== this.items.length ||
        !identity(item?.id) ||
        this.items.some((v) => v.id === item.id) ||
        !['message', 'reasoning'].includes(item.type) ||
        (item.type === 'message' &&
          (item.role !== 'assistant' || !Array.isArray(item.content) || item.content.length !== 0))
      )
        throw Error('AI 输出消息的身份、顺序或类型无效');
      this.items.push({ id: item.id, type: item.type, done: false, parts: [] });
    } else if (event.type === 'response.content_part.added') {
      const item = this.item(event);
      if (item.done || event.content_index !== item.parts.length)
        throw Error('AI 正文段重复或顺序无效');
      if (item.type === 'reasoning') {
        if (event.part?.type !== 'reasoning_text') throw Error('AI 推理段类型无效');
        item.parts.push({ text: '', done: false });
      } else {
        if (event.part?.type !== 'output_text' || typeof event.part.text !== 'string')
          throw Error('AI 会话只接受文本回复，不采用拒绝或工具内容');
        this.collect(event.part.text);
        item.parts.push({ text: event.part.text, done: false });
      }
    } else if (event.type === 'response.output_text.delta') {
      const part = this.part(event);
      if (part.done || typeof event.delta !== 'string')
        throw Error('AI 正文终态后仍收到分片或格式无效');
      this.collect(event.delta);
      part.text += event.delta;
    } else if (event.type === 'response.output_text.done') {
      const part = this.part(event);
      if (part.done || event.text !== part.text) throw Error('AI 正文终态重复或内容不一致');
      part.done = true;
    } else if (event.type === 'response.content_part.done') {
      const item = this.item(event);
      if (item.type === 'message') {
        const part = this.part(event);
        if (!part.done || event.part?.type !== 'output_text' || event.part.text !== part.text)
          throw Error('AI 正文段终态缺失或内容不一致');
      }
    } else if (event.type === 'response.output_item.done') {
      const item = this.item({ ...event, item_id: event.item?.id });
      if (item.done) throw Error('AI 输出消息重复完成');
      this.match(item, event.item);
      item.done = true;
    } else if (event.type === 'response.completed') {
      const result = event.response;
      if (!Array.isArray(result.output) || result.output.length !== this.items.length)
        throw Error('AI 完成结果的消息数量不一致');
      for (let i = 0; i < this.items.length; i++) {
        if (!this.items[i].done) throw Error('AI 输出消息尚未完整结束');
        this.match(this.items[i], result.output[i]);
      }
      this.flush();
      return true;
    }
    this.flush();
    return false;
  }
  private item(event: any): OutputItem {
    const item = index(event.output_index) ? this.items[event.output_index] : undefined;
    if (!item || event.item_id !== item.id) throw Error('AI 正文所属消息身份不一致');
    return item;
  }
  private part(event: any): TextPart {
    const item = this.item(event);
    const part = index(event.content_index) ? item.parts[event.content_index] : undefined;
    if (item.type !== 'message' || item.done || !part) throw Error('AI 正文所属段缺失或已结束');
    return part;
  }
  private match(item: OutputItem, result: any) {
    if (!result || result.id !== item.id || result.type !== item.type)
      throw Error('AI 完成消息的身份或类型不一致');
    if (item.type === 'reasoning') {
      if (result.status !== undefined && result.status !== 'completed')
        throw Error('AI 推理消息尚未完整结束');
      return;
    }
    if (
      result.role !== 'assistant' ||
      result.status !== 'completed' ||
      !Array.isArray(result.content) ||
      result.content.length !== item.parts.length ||
      item.parts.some(
        (p, i) =>
          !p.done || result.content[i]?.type !== 'output_text' || result.content[i].text !== p.text,
      )
    )
      throw Error('AI 完成消息的正文与已接收分段不一致');
  }
  private collect(text: string) {
    this.collected += text.length;
    if (this.collected > 100000) throw Error('AI 回复超过 100000 字符');
  }
  private flush() {
    while (this.outputCursor < this.items.length) {
      const item = this.items[this.outputCursor];
      if (item.type === 'reasoning') {
        this.outputCursor++;
        continue;
      }
      const part = item.parts[this.partCursor];
      if (part) {
        const next = part.text.slice(this.partOffset);
        if (next) this.append(next);
        this.partOffset = part.text.length;
        if (!part.done) return;
        this.partCursor++;
        this.partOffset = 0;
      } else {
        if (!item.done) return;
        this.outputCursor++;
        this.partCursor = 0;
      }
    }
  }
}
