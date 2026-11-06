import type { Flow, Step as Node } from '../shared/types';
import { ProjectDiagnostic } from './configuration';

type Edge = { from: string; to: string; label: string };
type Graph = { blocks: Map<string, string[]>; labels: Map<string, string>; edges: Edge[] };
const idPattern = '[A-Za-z0-9_-]{1,100}';
export function readGraph(source: string, file: string): Graph {
  if (new TextEncoder().encode(source).byteLength > 512 * 1024) throw new ProjectDiagnostic('graph-size', 'Mermaid超过512KiB', file);
  const graph: Graph = { blocks: new Map([['root', []]]), labels: new Map(), edges: [] };
  const stack = ['root']; let header = false;
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const line = raw.trim().replace(/;$/, '');
    const fail = () => new ProjectDiagnostic('graph-syntax', '不支持的编排语法，第' + (index + 1) + '行', file);
    if (!line || line.startsWith('%%')) continue;
    if (!header) { if (!/^(flowchart|graph)\s+(TD|TB|LR)$/.test(line)) throw fail(); header = true; continue; }
    let match = new RegExp('^subgraph (' + idPattern + '__' + '(?:then|else|body))\\["([^"<>]*)"\\]$').exec(line);
    if (match) {
      if (graph.blocks.has(match[1])) throw new ProjectDiagnostic('graph-duplicate-block', '重复结构块', file, match[1]);
      graph.blocks.set(match[1], []); stack.push(match[1]); continue;
    }
    if (line === 'end') { if (stack.length === 1) throw fail(); stack.pop(); continue; }
    match = new RegExp('^(' + idPattern + ')\\["([^"<>]*)"\\]$').exec(line);
    if (match) {
      if (graph.labels.has(match[1])) throw new ProjectDiagnostic('graph-duplicate-node', '区块ID重复', file, match[1]);
      graph.labels.set(match[1], match[2]); graph.blocks.get(stack.at(-1)!)!.push(match[1]); continue;
    }
    match = new RegExp('^(' + idPattern + ')\\s*-->(?:\\|(next|then|else|body)\\|)?\\s*(' + idPattern + ')$').exec(line);
    if (!match) throw fail();
    graph.edges.push({ from: match[1], label: match[2] || 'next', to: match[3] });
  }
  if (!header || stack.length !== 1) throw new ProjectDiagnostic('graph-unclosed', '缺少flowchart声明或结构块未闭合', file);
  return graph;
}
export function compileGraph(source: string, nodes: Record<string, Node>, file: string): Flow['steps'] {
  const graph = readGraph(source, file); const consumed = new Set<Edge>(); const blocks = new Set(['root']);
  for (const key of Object.keys(nodes)) if (!graph.labels.has(key)) throw new ProjectDiagnostic('orphan-binding', '节点配置没有Mermaid区块', file, key);
  const block = (name: string, depth: number): Node[] => {
    if (depth > 20) throw new ProjectDiagnostic('graph-depth', '结构嵌套超过20层', file);
    const ids = graph.blocks.get(name);
    if (!ids) throw new ProjectDiagnostic('missing-block', '结构块缺失：' + name, file);
    const set = new Set(ids), links = graph.edges.filter(e => e.label === 'next' && set.has(e.from) && set.has(e.to));
    const heads = ids.filter(id => !links.some(e => e.to === id));
    if (ids.length && heads.length !== 1) throw new ProjectDiagnostic('graph-order', '区块必须形成单一顺序链，禁止隐式环或并行', file, name);
    const result: Node[] = [], seen = new Set<string>(); let current = heads[0];
    while (current) {
      if (seen.has(current)) throw new ProjectDiagnostic('graph-cycle', '禁止隐式图环', file, current);
      seen.add(current);
      const raw = nodes[current];
      if (!raw || raw.id !== current) throw new ProjectDiagnostic('missing-binding', '区块缺少对应节点配置', file, current);
      const node = structuredClone(raw);
      if (node.type === 'condition' || node.type === 'loop') {
        for (const child of node.type === 'condition' ? ['then', 'else'] : ['body']) {
          const key = current + '__' + child; blocks.add(key);
          const content = block(key, depth + 1);
          (node as any)[child] = content;
          const branch = graph.edges.filter(e => e.from === current && e.label === child);
          if (branch.length !== (content.length ? 1 : 0) || (content.length && branch[0].to !== content[0].id))
            throw new ProjectDiagnostic('graph-branch', '结构连线与子块入口不一致', file, key);
          branch.forEach(e => consumed.add(e));
        }
      }
      // Diagram labels are presentation only: name is a semantic filename on file/Excel nodes.
      // Preserve the complete binding rather than rewriting it from the Mermaid label.
      result.push(node);
      const outgoing = links.filter(e => e.from === current);
      if (outgoing.length > 1) throw new ProjectDiagnostic('graph-branch', '普通next连线不能分叉', file, current);
      if (outgoing[0]) consumed.add(outgoing[0]); current = outgoing[0]?.to;
    }
    if (seen.size !== ids.length) throw new ProjectDiagnostic('graph-disconnected', '存在未连接或成环的区块', file, name);
    return result;
  };
  const result = block('root', 0);
  if (blocks.size !== graph.blocks.size || graph.edges.some(e => !consumed.has(e)))
    throw new ProjectDiagnostic('graph-extra-edge', '存在未知结构块、跨块next连线或多余连线', file);
  return result;
}
export function emitGraph(steps: Flow['steps']): { mermaid: string; nodes: Record<string, Node> } {
  const lines = ['flowchart TD'], edges: string[] = [], nodes: Record<string, Node> = {};
  const label = (v: string) => v.replace(/["<>\r\n]/g, ' ');
  const block = (list: Node[], scope?: string) => {
    if (scope) lines.push(`subgraph ${scope}["${scope.split('__').at(-1)}"]`);
    for (const [index, original] of list.entries()) {
      const node = structuredClone(original);
      lines.push(`${node.id}["${label(typeof node.name === 'string' ? node.name : node.id)}"]`);
      if (index) edges.push(`${list[index - 1].id} --> ${node.id}`);
      if (node.type === 'condition' || node.type === 'loop') {
        for (const child of node.type === 'condition' ? ['then', 'else'] : ['body']) {
          const content = (node as any)[child] as Node[];
          if (content.length) edges.push(`${node.id} -->|${child}| ${content[0].id}`);
          block(content, node.id + '__' + child); delete (node as any)[child];
        }
      }
      nodes[node.id] = node;
    }
    if (scope) lines.push('end');
  };
  block(steps); return { mermaid: [...lines, ...edges].join('\n') + '\n', nodes };
}
