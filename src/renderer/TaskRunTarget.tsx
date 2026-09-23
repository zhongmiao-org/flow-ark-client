import type { Flow, Run, Step } from '../shared/types';
import type { RunTargetContext } from '../shared/run-target-context';
import { taskStepTitle, taskStepValue } from './task-step-presentation';

export default function TaskRunTarget({
  run,
  flow,
  node,
  context,
  historical,
  next,
}: {
  run: Run;
  flow?: Flow;
  node?: Step;
  context?: RunTargetContext;
  historical: boolean;
  next: boolean;
}) {
  const current =
    context?.formatVersion === 1 && context.runId === run.id && context.versionId === run.versionId
      ? context
      : undefined;
  const facts: [string, string][] = [];
  const value = (input: unknown) =>
    flow && node ? taskStepValue(input, flow, node.id) : '来源不可确定';
  let note = '以下是本次运行的固定配置，不表示当前权限或外部结果已核对。';
  if (node) {
    if (node.type === 'desktop') {
      facts.push(
        [
          '应用目标',
          current?.desktop?.windowTitle
            ? '文本编辑 · ' + current.desktop.windowTitle
            : '此记录未提供窗口名称',
        ],
        ['操作', '替换原选区并回读'],
      );
      note = '窗口来自本次固定快照；实际修改与回读结果请查看应用修改回执。';
    } else if (node.type === 'browser') {
      const browser = current?.browser;
      const product = {
        embedded: '内置浏览器',
        chrome: 'Chrome',
        firefox: 'Firefox',
        safari: 'Safari',
      };
      facts.push([
        '浏览器',
        browser?.product
          ? product[browser.product]
          : browser
            ? '已绑定的浏览器'
            : '此记录未提供浏览器身份',
      ]);
      if (browser?.page)
        facts.push(
          [
            browser.page.source === 'selected' ? '选择时的网页' : '运行前核对的网页',
            browser.page.title || '未命名网页',
          ],
          ['当时的地址', browser.page.url],
        );
      if (node.operation === 'navigate') facts.push(['配置的打开地址', value(node.value)]);
      else if (node.operation !== 'screenshot')
        facts.push(['步骤定位', node.selector || '未设置元素定位']);
      if ('framePath' in node && node.framePath.length)
        facts.push(['内嵌页面路径', node.framePath.join(' → ')]);
      note = '网页信息来自运行快照；后续跳转、账号与页面当前内容未在此核对。';
    } else if (node.type === 'file' || node.type === 'excel') {
      const file = current?.files.find((entry) => entry.binding === node.binding);
      facts.push(
        ['文件资源', node.binding],
        ['绑定目录', file?.directory || '此记录未提供目录位置'],
        ['配置的文件名', value(node.name)],
      );
      note = '目录来自运行快照；动态文件名与实际读写结果以步骤回执和产物为准。';
    } else if (node.type === 'http') {
      facts.push(['网络请求', node.method], ['配置的地址', value(node.url)]);
      note = '配置地址中的引用在执行时确定；响应和外部修改需核对实际回执。';
    } else if (node.type === 'script') {
      facts.push(
        ['运行对象', '本机脚本进程'],
        ['脚本语言', node.language === 'ts' ? 'TypeScript' : 'JavaScript'],
      );
      note = '脚本的实际文件、网页或网络操作取决于代码与输入，不能仅凭此卡片确定影响范围。';
    } else if (node.type === 'mcp') {
      facts.push(['工具对象引用', node.target], ['工具名称', node.tool]);
      note = '这里只显示固定配置，工具调用能力尚未开放，不表示已连接或执行成功。';
    } else {
      facts.push([
        '处理对象',
        node.type === 'human' ? '等待本次任务的人工确认' : '本次流程的数据与条件',
      ]);
      note = '此步骤没有独立的外部对象；整个流程的其他步骤可能仍产生外部修改。';
    }
  }
  const summary = (
    node?.type === 'file' || node?.type === 'excel' ? facts.slice(1) : facts.slice(0, 2)
  )
    .map(([, text]) => text)
    .join(' · ');
  return (
    <section className="task-run-file task-run-target" aria-label="运行对象说明">
      <h3>{historical ? '记录中的对象' : next ? '下一步对象' : '当前对象'}</h3>
      {node ? (
        <>
          <p>{summary}</p>
          <details key={`${run.id}:${node.id}`}>
            <summary>查看快照中的对象与定位</summary>
            <p>{taskStepTitle(node)}</p>
            <dl>
              {facts.map(([label, text]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
            <p className="task-run-target-note">{note}</p>
          </details>
        </>
      ) : (
        <p>
          {run.state === 'QUEUED'
            ? '尚未开始步骤，开始后显示对应对象。'
            : '当前记录不足以确定对应步骤与对象。'}
        </p>
      )}
    </section>
  );
}
