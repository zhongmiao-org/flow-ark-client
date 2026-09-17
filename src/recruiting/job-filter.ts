import type { JobFilter, JobSnapshot, Policy } from '../shared/types';
import { validateObject } from '../core/validate';

const text = (value: string) => value.normalize('NFKC').trim().toLowerCase();
export const defaultJobFilter = (): JobFilter => ({
  cities: [],
  includedCompanies: [],
  excludedKeywords: [],
  workModes: [],
  salary: { enabled: false, minimumMonthly: 0, maximumMonthly: 0, currency: 'CNY' },
});
export function validateJobFilter(filter?: JobFilter) {
  if (!filter) return;
  validateObject('RecruitingJobFilter', filter);
  for (const values of [filter.cities, filter.includedCompanies, filter.excludedKeywords]) {
    if (values.some((v) => !text(v))) throw new Error('岗位筛选条件不能只含空格');
    if (new Set(values.map(text)).size !== values.length) throw new Error('岗位筛选条件重复');
  }
  if (new Set(filter.workModes).size !== filter.workModes.length) throw new Error('工作方式重复');
  const salary = filter.salary;
  if (salary.enabled) {
    if (!salary.minimumMonthly && !salary.maximumMonthly)
      throw new Error('启用薪资筛选时至少填写一个边界');
    if (salary.maximumMonthly && salary.minimumMonthly > salary.maximumMonthly)
      throw new Error('月薪下限不能高于上限');
  }
}
export function jobContent(snapshot?: JobSnapshot) {
  if (!snapshot) return null;
  const { observedAt: _observedAt, ...content } = snapshot;
  return content;
}
export function jobSnapshotProblem(snapshot: JobSnapshot): string | undefined {
  try {
    validateObject('RecruitingJobSnapshot', snapshot);
    if (
      ![snapshot.title, snapshot.company, snapshot.source].every((v) => v.trim()) ||
      (snapshot.city !== null && !snapshot.city.trim()) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        snapshot.observedAt,
      ) ||
      !Number.isFinite(Date.parse(snapshot.observedAt))
    )
      return '岗位详情来源或观察时间无效';
    if (
      snapshot.salary &&
      (snapshot.salary.minimum <= 0 || snapshot.salary.maximum < snapshot.salary.minimum)
    )
      return '岗位薪资区间无效';
  } catch {
    return '岗位详情证据格式无效';
  }
}
export function jobFilterDecision(
  job: { job: string; company: string; jobSnapshot?: JobSnapshot },
  policy: Policy,
): string | undefined {
  if (policy.excludedCompanies.some((x) => job.company.includes(x))) return '公司在排除名单';
  if (policy.keywords.length && !policy.keywords.some((x) => job.job.includes(x)))
    return '职位不匹配筛选条件';
  const filter = policy.jobFilter;
  validateJobFilter(filter);
  const active =
    filter &&
    (filter.cities.length ||
      filter.includedCompanies.length ||
      filter.excludedKeywords.length ||
      filter.workModes.length ||
      filter.salary.enabled);
  const snapshot = job.jobSnapshot;
  if (!snapshot) return active ? '缺少当前岗位详情证据，无法核对筛选条件' : undefined;
  const problem = jobSnapshotProblem(snapshot);
  if (problem) return problem;
  if (text(snapshot.title) !== text(job.job) || text(snapshot.company) !== text(job.company))
    return '岗位列表与详情的职位或公司不一致';
  if (!filter) return;
  if (filter.cities.length) {
    if (!snapshot.city) return '岗位未明确城市，需要人工核对';
    if (!filter.cities.some((v) => text(v) === text(snapshot.city!))) return '岗位城市不在配置范围';
  }
  if (
    filter.includedCompanies.length &&
    !filter.includedCompanies.some((v) => text(snapshot.company).includes(text(v)))
  )
    return '岗位公司不在配置范围';
  if (filter.excludedKeywords.some((v) => text(snapshot.title).includes(text(v))))
    return '职位包含排除词';
  if (filter.workModes.length) {
    if (!snapshot.workMode) return '岗位未明确工作方式，需要人工核对';
    if (!filter.workModes.includes(snapshot.workMode)) return '岗位工作方式不在配置范围';
  }
  if (filter.salary.enabled) {
    const salary = snapshot.salary;
    if (!salary || salary.currency !== 'CNY' || salary.period !== 'month')
      return '缺少可核对的人民币月薪范围，不自动换算';
    if (salary.minimum < filter.salary.minimumMonthly) return '岗位月薪下限低于配置要求';
    if (filter.salary.maximumMonthly && salary.maximum > filter.salary.maximumMonthly)
      return '岗位月薪上限超过配置范围';
  }
}
