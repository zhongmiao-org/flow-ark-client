import type { Flow } from '../shared/types';
import { walk } from '../core/validate';
/** Local source references are bindings, never portable defaults or fixed cursors. */
export function assertPortableSourceFlow(flow: Flow) {
  for (const node of walk(flow.steps))
    if (node.type === 'source' && node.operation === 'read') {
      const v = node.cursor;
      if (
        v !== null &&
        (!v ||
          typeof v !== 'object' ||
          Array.isArray(v) ||
          Object.keys(v).length !== 1 ||
          typeof v.$ref !== 'string')
      )
        throw Error('公开来源读取位置只能从头开始或引用前序变量；请移除固定私人游标');
    }
  const visit = (v: any, depth: number) => {
    if (depth > 48) throw Error('公开流程嵌套超限');
    if (!v || typeof v !== 'object') return;
    if (
      v.version === 1 &&
      typeof v.archiveId === 'string' &&
      typeof v.sessionId === 'string' &&
      typeof v.sha256 === 'string'
    )
      throw Error('公开流程不能包含本机完整来源引用，请改为只读来源资源及变量引用');
    for (const child of Object.values(v)) visit(child, depth + 1);
  };
  visit(flow, 0);
}
