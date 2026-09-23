import type { RunReviewPreview } from '../shared/run-review';

type Check = RunReviewPreview['checks'][number];

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

export default function RunReviewCheck({ check }: { check: Check }) {
  const issue = check.passed ? { summary: check.detail, next: '' } : explanation(check.detail);
  const expandedDetail = issue.summary !== check.detail && !!check.detail;
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
