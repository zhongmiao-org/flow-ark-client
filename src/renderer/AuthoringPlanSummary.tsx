import { Tag } from 'antd';
function Steps({ steps, entryId, scripts }: { steps: any[]; entryId: string; scripts: any[] }) {
  return <ol>{steps.map((node: any) => { const script = scripts.find(s => s.entryId === entryId && s.nodeId === node.id); return <li key={node.id}>
    <strong>{typeof node.name === 'string' ? node.name : node.id}</strong> <Tag>{node.type}</Tag>{script && <Tag color={script.ready ? 'green' : 'default'}>{script.ready ? '代码已暂存' : '待生成代码'}</Tag>}
    {node.purpose && <p>{node.purpose}</p>}{['then','else','body'].filter(k => node[k]?.length).map(k => <div key={k}><span>{k === 'then' ? '满足条件' : k === 'else' ? '其他情况' : '串行循环'}</span><Steps steps={node[k]} entryId={entryId} scripts={scripts} /></div>)}
  </li>; })}</ol>;
}
export default function AuthoringPlanSummary({ value }: { value: any }) {
  if (!value?.plan) return null;
  return <section aria-label="流程节点规划"><p>{value.summary}</p><p>先规划节点，再分别生成代码，最后由工具组装；每次组装按当前SDK重新校验。可在上方通过对话调整；尚未执行任务。</p>
    {value.plan.entries.map((entry: any) => <div key={entry.id}><h4>{entry.name}</h4><Steps steps={entry.steps} entryId={entry.id} scripts={value.scripts ?? []} /></div>)}
    <p>资源：{value.plan.resources.map((r: any) => r.name).join('、') || '无'}；声明动作：{value.plan.actions.map((a: any) => a.name).join('、') || '无'}。动作默认禁止，运行前另行核对。</p>
    <Tag color={value.assembledRevision ? 'green' : 'blue'}>{value.assembledRevision ? '已组装并静态编译，业务待验收' : '草稿暂存，不可运行'}</Tag>
  </section>;
}
