import { Button, Card, Collapse } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import type { Flow } from '../shared/types';
import { flatten } from './flow-editing';
import { taskStepSummary, taskStepTitle, type TaskStepContext } from './task-step-presentation';
import './task-plan-scope.css';

/** A projection of the displayed plan, never an execution estimate or permission grant. */
export default function TaskPlanScope({
  flow,
  context,
  select,
  compact = false,
}: {
  flow: Flow;
  context: TaskStepContext;
  select: (id: string) => void;
  compact?: boolean;
}) {
  const steps = flatten(flow.steps);
  const operations = steps.filter(
    (step) => !['value', 'assert', 'condition', 'loop'].includes(step.type),
  );
  const counts = new Map<string, number>();
  for (const step of operations) {
    const label =
      step.type === 'file' || step.type === 'excel'
        ? taskStepTitle(step)
        : taskStepTitle({ ...step, name: '' });
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const branching = steps.some((step) => step.type === 'loop' || step.type === 'condition');
  return (
    <section
      className={`task-plan-scope${compact ? ' task-plan-scope-compact' : ''}`}
      aria-label="方案操作范围"
    >
      <Card size="small" className="task-plan-scope-card">
        {!compact && <h3>这份方案会涉及哪些操作？</h3>}
        <p>
          {operations.length
            ? [...counts].map(([label, count]) => `${label} ${count} 步`).join(' · ')
            : '当前方案仅包含数据处理、条件、循环或断言步骤，没有网页、文件、工具等操作步骤。'}
        </p>
        {!compact && branching && (
          <p>包含条件或循环内的步骤；实际执行次数由运行时数据和分支决定。</p>
        )}
        {(compact || operations.length > 0) && (
          <Collapse
            items={[
              {
                key: 'operations',
                onKeyDown: activateCollapseWithSpace,
                label: `核对操作对象与影响 · ${operations.length} 个步骤`,
                children: (
                  <>
                    {compact && (
                      <p>
                        这里展示方案定义，不代表已执行或已授权。试运行前仍需核对当前对象、参数和实际读写范围。
                      </p>
                    )}
                    {compact && <p>保存或采纳只更新草稿。当前运行和已建立的计划继续使用原快照。</p>}
                    {compact && branching && (
                      <p>包含条件或循环内的步骤；实际执行次数由运行时数据和分支决定。</p>
                    )}
                    <div className="task-plan-scope-list">
                      {operations.map((step) => (
                        <Button key={step.id} onClick={() => select(step.id)}>
                          <strong>
                            第 {steps.findIndex((entry) => entry.id === step.id) + 1} 步 ·{' '}
                            {taskStepTitle(step)}
                          </strong>
                          <span>{taskStepSummary(step, flow, context)}</span>
                          <small>查看完整参数</small>
                        </Button>
                      ))}
                    </div>
                  </>
                ),
              },
            ]}
          />
        )}
        {!compact && (
          <p>
            这里展示方案定义，不代表已执行或已授权。试运行前仍需核对当前对象、参数和实际读写范围。
          </p>
        )}
      </Card>
    </section>
  );
}
