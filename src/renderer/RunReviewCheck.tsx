import { Alert, Badge, Button, Collapse, Tag } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { runStateColors } from './theme';
import type { RunReviewPreview } from '../shared/run-review';

type Check = RunReviewPreview['checks'][number];

/** Recognize only messages authored by the existing review/binding code. */
export function reviewRecoveryIssue(check: Check) {
  const resource = reviewResourceIssue(check);
  if (resource) return { ...resource, recovery: 'configure' as const, status: '启动已阻止' };
  if (check.passed) return undefined;
  if (
    check.detail === '请先选择本机浏览器' ||
    /^(浏览器未绑定：|浏览器绑定不存在：)/.test(check.detail)
  )
    return {
      title: '浏览器绑定未完成',
      status: '资源未绑定',
      action: '检查浏览器绑定',
      next: '打开流程的参数与资源，明确选择本次使用的浏览器并保存，再回来重新检查。不会自动切换执行方式。',
      warning: true,
      recovery: 'configure' as const,
    };
  if (
    [
      '浏览器安装已变化，请重新选择',
      '浏览器可执行文件与产品标识不匹配',
      '所选程序不是支持验证的浏览器',
      'Chrome 版本过低，请自行更新后重新选择',
      '缺少用户指定的本机 geckodriver；不会自动下载',
      '当前运行环境不支持内置浏览器',
    ].includes(check.detail)
  )
    return {
      title: '所选浏览器不可用',
      status: '启动已阻止',
      action: '检查浏览器绑定',
      next: '核对本机设置中的安装与驱动，再检查流程绑定。不会自动更换浏览器或下载依赖。',
      warning: false,
      recovery: 'configure' as const,
    };
  if (
    [
      '检查期间流程或任务已改变，请重新检查',
      '检查期间流程、授权或资源已改变，请重新检查',
      '任务或关联流程已改变，请重新检查',
      '试运行检查已过期，请重新检查并核对',
      '试运行检查已过期，请重新检查',
      '试运行授权已失效，请重新检查',
      '试运行资源或网页已改变，请重新检查',
    ].includes(check.detail)
  )
    return {
      title: '方案或授权需要重新核对',
      status: '需重新核对',
      action: '重新检查',
      next: '本次检查已失效，尚未创建运行。重新检查后仍需核对当前内容并明确确认，不会直接执行。',
      warning: true,
      recovery: 'refresh' as const,
    };
  if (
    [
      '未取得内置网页身份，请重新检查',
      '内置网页正在加载，请稍后重新检查',
      '内置网页资源身份不完整',
    ].includes(check.detail)
  )
    return {
      title: '内置网页尚未就绪',
      status: '需要核对',
      action: '重新检查',
      next: '等待网页就绪后重新读取身份。检查不会导航网页或重放已有操作。',
      warning: true,
      recovery: 'refresh' as const,
    };
  return undefined;
}

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
  refresh,
  disabled = false,
}: {
  check: Check;
  compact?: boolean;
  configure?: () => void;
  refresh?: () => void;
  disabled?: boolean;
}) {
  const resourceIssue = reviewRecoveryIssue(check);
  const recover = resourceIssue?.recovery === 'refresh' ? refresh : configure;
  if (resourceIssue)
    return (
      <section aria-label={resourceIssue.title}>
        <Alert
          type={resourceIssue.warning ? 'warning' : 'error'}
          role="note"
          showIcon
          title={resourceIssue.title}
          description={
            <div className="feedback-body">
              <Tag
                className="run-state-tag"
                color={runStateColors[resourceIssue.warning ? 'INTERRUPTED' : 'FAILED']}
              >
                {resourceIssue.status}
              </Tag>
              <p>{check.detail}</p>
              <p>{resourceIssue.next}</p>
              {recover && (
                <Button type="primary" disabled={disabled || undefined} onClick={recover}>
                  {resourceIssue.action}
                </Button>
              )}
            </div>
          }
        />
      </section>
    );
  const issue = check.passed ? { summary: check.detail, next: '' } : explanation(check.detail);
  const expandedDetail = issue.summary !== check.detail && !!check.detail;
  if (compact && check.passed)
    return (
      <Collapse
        className="run-review-check-compact"
        items={[
          {
            key: 'passed',
            forceRender: true,
            onKeyDown: activateCollapseWithSpace,
            label: (
              <>
                <Badge status="success" />
                <span className="sr-only">通过：</span>
                {check.name}
              </>
            ),
            children: (
              <>
                <p>{check.detail}</p>
              </>
            ),
          },
        ]}
      />
    );
  return (
    <Alert
      type={check.passed ? 'success' : 'error'}
      role="note"
      showIcon
      title={
        <>
          <span className="sr-only">{check.passed ? '通过：' : '未通过：'}</span>
          {check.name}
        </>
      }
      description={
        <div className="feedback-body">
          <p>{issue.summary}</p>
          {issue.next && <p>{issue.next}</p>}
          {expandedDetail && (
            <Collapse
              className="run-review-check-detail"
              items={[
                {
                  key: 'details',
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  label: <>查看检查详情</>,
                  children: (
                    <>
                      <pre tabIndex={0} aria-label={`${check.name}的检查详情`}>
                        {check.detail}
                      </pre>
                    </>
                  ),
                },
              ]}
            />
          )}
        </div>
      }
    />
  );
}
