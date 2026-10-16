import type { AINodeReceipt, Event } from '../shared/types';
import { runDisplayLabels } from '../shared/run-history';
import { ai_receipt_v1 } from '../shared/node-schema.generated';
import { aiReceiptMessage } from '../shared/ai-outcome';

export function runEventTitle(event: Event): string {
  switch (event.type) {
    case 'ai-outcome':
      return event.data?.status === 'failed' ? 'AI请求失败' : 'AI请求结果';
    case 'state':
      return '运行状态';
    case 'node-start':
      return '步骤开始';
    case 'node-end':
      return event.data?.completed === true ? '步骤完成' : '步骤结束';
    case 'debug-pause':
      return '调试暂停';
    case 'log':
      return '运行日志';
    case 'progress':
      return '数量报告';
    case 'error':
      return '错误记录';
    case 'artifact':
      return '产物记录';
    case 'system-suspend':
      return '系统睡眠记录';
    default:
      return event.type;
  }
}

export function runEventMessage(event: Event): string {
  const data = event.data ?? {};
  if (event.type === 'ai-outcome')
    return ai_receipt_v1(data)
      ? aiReceiptMessage(data as AINodeReceipt)
      : 'AI回执格式尚未确认，保留原始脱敏记录';
  if (event.type === 'state') {
    const state = data.state;
    return typeof state === 'string' && Object.hasOwn(runDisplayLabels, state)
      ? `已保存状态：${runDisplayLabels[state as keyof typeof runDisplayLabels]}`
      : '状态详情见原始记录';
  }
  if (event.type === 'node-start') return '开始执行此步骤';
  if (event.type === 'node-end')
    return data.completed === true ? '此步骤已完成' : '步骤结束，结果待核对';
  if (event.type === 'debug-pause') return '暂停在此步骤之前';
  if (event.type === 'progress') {
    const { completed, total } = data;
    if (typeof completed === 'number' && Number.isFinite(completed) && completed >= 0) {
      if (total === undefined) return `脚本报告已处理 ${completed}`;
      if (typeof total === 'number' && Number.isFinite(total) && total >= completed)
        return `脚本报告 ${completed} / ${total}`;
    }
    return '进度记录含无效数量，原始内容保留';
  }
  if (event.type === 'log') {
    const value = Object.hasOwn(data, 'value') ? data.value : data.message;
    if (value === undefined) return '日志记录缺少内容';
    if (value === '') return '（空文本）';
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  }
  if (event.type === 'error')
    return typeof data.message === 'string' ? data.message : '错误详情见原始记录';
  if (event.type === 'artifact')
    return typeof data.name === 'string' ? `已登记产物：${data.name}` : '已登记运行产物';
  return '完整内容见原始记录';
}
