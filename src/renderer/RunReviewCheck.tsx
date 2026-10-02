import type { RunReviewPreview } from '../shared/run-review';

type Check = RunReviewPreview['checks'][number];

/** Match only host-authored resource messages; arbitrary filesystem errors remain generic. */
export function reviewResourceIssue(check: Check) {
  if (check.passed) return undefined;
  if (
    /^(目录未绑定：|未绑定文件目录：|文件路径未绑定：|入口缺少资源绑定：|资源类型不符：|本机资源不可用：|文件目录不可用，请重新选择：)/.test(
      check.detail,
    )
  )
    return {
      title: /^(目录未绑定：|未绑定文件目录：|文件路径未绑定：|入口缺少资源绑定：)/.test(
        check.detail,
      )
        ? '资源绑定未完成'
        : '绑定资源不可用',
      action: '重新绑定资源',
      next: '原绑定仍保留。打开所属流程的参数与资源，核对位置和类型，保存后重新检查。',
      warning: false,
    };
  if (
    /^(未绑定本地脚本依赖：|本地脚本依赖名称或版本不匹配：|脚本依赖必须声明精确版本：|同一流程的依赖版本冲突：|节点依赖重复：|依赖源文件缺少 package.json：|未声明的脚本依赖：|脚本依赖未能静态打包：|脚本依赖不支持此静态文件类型：|脚本依赖超出编译大小限制|脚本依赖无法静态固定：)/.test(
      check.detail,
    )
  )
    return {
      title: '脚本依赖未就绪',
      action: '检查脚本与依赖',
      next: '打开流程中的脚本步骤，核对依赖声明、精确版本和本机包目录，保存后重新检查。运行中不会自动安装依赖。',
      warning: true,
    };
  return undefined;
}

/** Presentation of known host messages only; never changes admission or retries. */
function explanation(detail: string) {
  const compact = detail.length <= 240 && detail.split('\n').length <= 3;
  if (detail.startsWith('格式无效 (FlowDefinition):'))
    return {
      summary: '保存的方案结构不完整，或不符合当前流程格式。',
      next: '打开“配置流程与资源”，检查步骤与必填参数，保存后回到这里重新检查。',
    };
  if (/^(目录未绑定：|文件路径未绑定：|入口缺少资源绑定：|资源类型不符：)/.test(detail))
    return {
      summary: compact ? detail : '资源绑定需要处理，具体资源见检查详情。',
      next: '打开“配置流程与资源”，核对提示中资源的绑定与类型，再重新检查。',
    };
  if (detail === '请先选择本机浏览器' || /^(浏览器未绑定：|浏览器绑定不存在：)/.test(detail))
    return {
      summary: compact ? detail : '浏览器绑定需要处理，具体资源见检查详情。',
      next: '打开“配置流程与资源”，重新选择本次使用的浏览器，再重新检查。',
    };
  if (/^检查期间流程(?:或任务|、授权或资源)已改变，请重新检查$/.test(detail))
    return {
      summary: detail,
      next: '点击“重新检查”读取当前方案与资源，核对后再确认本次运行。',
    };
  if (!compact)
    return {
      summary: '检查未通过，详细原因见下方。',
      next: '展开检查详情，核对后回到方案修改，或处理相关配置后重新检查。',
    };
  return { summary: detail || '尚未取得可用的检查结果。', next: '' };
}

export default function RunReviewCheck({
  check,
  compact = false,
  configure,
  disabled = false,
}: {
  check: Check;
  compact?: boolean;
  configure?: () => void;
  disabled?: boolean;
}) {
  const resourceIssue = reviewResourceIssue(check);
  if (resourceIssue)
    return (
      <section className="run-review-resource-issue" aria-label={resourceIssue.title}>
        <span className={`badge ${resourceIssue.warning ? 'state-INTERRUPTED' : 'state-FAILED'}`}>
          启动已阻止
        </span>
        <h3>{resourceIssue.title}</h3>
        <p className="run-review-resource-reason">{check.detail}</p>
        <p>{resourceIssue.next}</p>
        {configure && (
          <button className="primary" disabled={disabled} onClick={configure}>
            {resourceIssue.action}
          </button>
        )}
      </section>
    );
  const issue = check.passed ? { summary: check.detail, next: '' } : explanation(check.detail);
  const expandedDetail = issue.summary !== check.detail && !!check.detail;
  if (compact && check.passed)
    return (
      <div className="run-review-check run-review-check-compact">
        <span aria-hidden="true">☑</span>
        <details>
          <summary>
            <span className="sr-only">通过：</span>
            {check.name}
          </summary>
          <p>{check.detail}</p>
        </details>
      </div>
    );
  return (
    <div className={`run-review-check ${check.passed ? '' : 'failed'}`}>
      <span aria-hidden="true">{check.passed ? '✓' : '!'}</span>
      <div>
        <b>
          <span className="sr-only">{check.passed ? '通过：' : '未通过：'}</span>
          {check.name}
        </b>
        <p>{issue.summary}</p>
        {issue.next && <p>{issue.next}</p>}
        {expandedDetail && (
          <details className="run-review-check-detail">
            <summary>查看检查详情</summary>
            <pre tabIndex={0} aria-label={`${check.name}的检查详情`}>
              {check.detail}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
