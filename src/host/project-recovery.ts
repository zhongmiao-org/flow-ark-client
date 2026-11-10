import { digest, redactedErrorText } from '../shared/utils';

/** Model-facing evidence deliberately excludes outputs, screenshots and effect payloads. */
export function projectRunEvidence(detail: any, desktop: any[] = [], effects: any[] = []) {
  const run = detail.run;
  const error = run.error ? redactedErrorText(new Error(String(run.error))).slice(0, 1200) : null;
  const receipts = desktop.filter(r => r.runId === run.id).map(r => ({
    actionId: r.actionId, status: r.status,
    command:(detail.events??[]).find((e:any)=>e.type==='log'&&e.data?.actionId===r.actionId)?.data?.command??null,
    reason: typeof r.receipt?.reason === 'string' ? redactedErrorText(new Error(r.receipt.reason)).slice(0, 240) : null,
  }));
  const operations = effects.filter(e => e.runId === run.id).map(e => ({ id: e.id, action: e.action, state: e.state }));
  const uncertain = receipts.some(r => r.status === 'unknown') || operations.some(e => ['unknown','submitting'].includes(e.state));
  const text = [error, ...receipts.map(r => r.reason)].join(' ');
  const category = /user-intervention/.test(text) ? 'environment'
    : /focus-changed|window-context-changed|binding|绑定|窗口.*变化|目标页面/.test(text) ? 'target'
    : /permission|not-authorized|权限|钥匙串/.test(text) ? 'permission'
    : /AI 输出|AIRequest|模型|API|provider/.test(text) ? 'provider'
    : /script-syntax|script-types|tool-arguments|SDK|类型|语法/.test(text) ? 'code'
    : /回读|选区|保存|结果.*不一致/.test(text) ? 'verification' : 'inspection';
  const guidance: Record<string, [string,string]> = {
    environment: ['操作前检测到桌面输入变化','先核对当前窗口、鼠标及修饰键状态；这不是代码编译失败。未确认的操作结果仍须核对。'],
    target: ['原先选择的目标需要重新核对','检查当前网页、窗口和绑定，再通过原运行核对继续；不要切换对象重放未知操作。'],
    permission: ['系统或资源权限尚未满足','通过客户端检查权限；系统授权由本人完成，不向AI提供密码。'],
    provider: ['AI服务没有完成本次请求','保留已有代码和用量记录，检查配置及失败原因；付费重试需要明确选择。'],
    code: ['节点实现未通过正式检查','AI可依据诊断提出局部修复；已批准节点中的语法、类型和参数问题由AI处理，不要求用户改代码。'],
    verification: ['实际结果没有通过核对','先只读检查实际范围与回执，再提出受影响节点的修复；不能忽略校验或重复粘贴。'],
    inspection: ['运行需要进一步检查','把当前证据接回AI对话，先查明原因和影响范围，不猜测已执行或成功。'],
  };
  const [title, guidanceText] = guidance[category];
  const summary = { runId: run.id, createdAt:run.createdAt, localTime:new Date(run.createdAt).toLocaleString('zh-CN',{hour12:false}),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone, versionId: run.versionId, state: run.state, error,
    steps: (detail.events ?? []).filter((e:any) => e.nodeInstance && ['node-start','node-end','error'].includes(e.type)).map((e:any) => ({ nodeId:e.nodeInstance,type:e.type,state:e.data?.state??null })).slice(-100),
    desktopReceipts:receipts, effects:operations, recovery:{category,title,guidance:guidanceText,requiresReconciliation:uncertain,replayAllowed:false},
  };
  return { ...summary, stamp: digest(summary) };
}
