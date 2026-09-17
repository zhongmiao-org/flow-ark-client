import type { Flow, Step } from '../../src/shared/types';
type Operation = Extract<Step, { type: 'browser' }>['operation'];
export const formText = 'FlowArk 本地虚构文件\n第二行';
export const formExpected = {
  fullName: '测试用户甲',
  email: 'tester@example.com',
  passwordLength: 12,
  phone: '13800000000',
  website: 'https://example.com',
  quantity: '7',
  search: '流程 测试',
  readonlyCode: 'LAB-2026',
  language: 'TypeScript',
  notes: '第一行\n第二行 & <测试>',
  richNote: '可编辑文本',
  channel: 'email',
  features: ['audit', 'alert'],
  department: 'engineering',
  skills: ['ts', 'qa'],
  startDate: '2026-09-17',
  endDate: '2026-09-20',
  time: '09:30',
  localTime: '2026-09-17T09:30',
  month: '2026-09',
  week: '2026-W38',
  priority: '2',
  color: '#cc6633',
  province: 'zhejiang',
  city: 'hangzhou',
  project: 'flowark',
  sync: true,
  invoice: true,
  invoiceTitle: '虚构测试公司',
  contacts: [
    { name: '测试联系人一', email: 'one@example.com' },
    { name: '测试联系人二', email: 'two@example.com' },
  ],
  agreement: true,
  fixtureVersion: 'form-lab-v1',
  attachment: {
    name: 'fictional.txt',
    type: 'text/plain',
    size: Buffer.byteLength(formText),
    content: formText,
  },
};
export function formBrowser(
  id: string,
  operation: Operation,
  selector: string,
  value: any = null,
  timeoutMs = 10000,
): Step {
  return {
    id,
    name: id,
    type: 'browser',
    version: 3,
    operation,
    selector,
    value,
    framePath: [],
    timeoutMs,
  };
}
export function formLabFlow(url = 'http://127.0.0.1:4178'): Flow {
  const steps: Step[] = [formBrowser('open', 'navigate', '', { $ref: 'params.baseUrl' })];
  const fill = (id: string, selector: string, value: string, verify = true) => {
    steps.push(formBrowser('fill_' + id, 'fill', selector, value));
    if (verify)
      steps.push(formBrowser('read_' + id, 'inputValue', selector), {
        id: 'verify_' + id,
        type: 'assert',
        version: 1,
        actual: { $ref: 'steps.read_' + id },
        operator: 'equals',
        expected: value,
      });
  };
  for (const [id, selector, value] of [
    ['name', '#full-name', formExpected.fullName],
    ['email', '#email', formExpected.email],
    ['phone', '#phone', formExpected.phone],
    ['website', '#website', formExpected.website],
    ['quantity', '#quantity', '7'],
    ['search', '#search', formExpected.search],
    ['language', '#language', 'TypeScript'],
    ['notes', '#notes', formExpected.notes],
    ['start', '#start-date', formExpected.startDate],
    ['end', '#end-date', formExpected.endDate],
    ['time', '#time', '09:30'],
    ['local', '#local-time', formExpected.localTime],
    ['month', '#month', '2026-09'],
    ['week', '#week', '2026-W38'],
    ['color', '#color', '#cc6633'],
  ])
    fill(id, selector, value);
  fill('password', '#password', 'fictional123', false);
  fill('rich', '#rich-note', formExpected.richNote, false);
  steps.push(formBrowser('readonly', 'inputValue', '#readonly-code'), {
    id: 'verify_readonly',
    type: 'assert',
    version: 1,
    actual: { $ref: 'steps.readonly' },
    operator: 'equals',
    expected: 'LAB-2026',
  });
  steps.push(
    formBrowser('priority_home', 'press', '#priority', 'Home'),
    formBrowser('priority_right', 'press', '#priority', 'ArrowRight'),
    formBrowser('priority_right_again', 'press', '#priority', 'ArrowRight'),
    formBrowser('priority_value', 'inputValue', '#priority'),
    {
      id: 'verify_priority',
      type: 'assert',
      version: 1,
      actual: { $ref: 'steps.priority_value' },
      operator: 'equals',
      expected: '2',
    },
  );
  for (const [id, selector, value] of [
    ['phone', '#channel-phone', true],
    ['email', '#channel-email', true],
    ['email_again', '#channel-email', true],
    ['export', '#feature-export', false],
    ['export_again', '#feature-export', false],
    ['audit', '#feature-audit', true],
    ['audit_again', '#feature-audit', true],
    ['alert', '#feature-alert', true],
    ['agreement', '#agreement', true],
  ] as const)
    steps.push(formBrowser('check_' + id, 'check', selector, value));
  steps.push(
    formBrowser('department', 'select', '#department', 'engineering'),
    formBrowser('skills_first', 'select', '#skills', ['node']),
    formBrowser('skills_clear', 'select', '#skills', []),
    {
      id: 'verify_clear',
      type: 'assert',
      version: 1,
      actual: { $ref: 'steps.skills_clear' },
      operator: 'equals',
      expected: [],
    },
    formBrowser('skills', 'select', '#skills', ['ts', 'qa']),
    {
      id: 'verify_skills',
      type: 'assert',
      version: 1,
      actual: { $ref: 'steps.skills' },
      operator: 'equals',
      expected: ['ts', 'qa'],
    },
  );
  steps.push(
    formBrowser('province_first', 'select', '#province', 'jiangsu'),
    formBrowser('province', 'select', '#province', 'zhejiang'),
    formBrowser('cities_ready', 'wait', '#city:not(:disabled)'),
    formBrowser('city', 'select', '#city', 'hangzhou'),
  );
  fill('project', '#project-search', 'FlowArk', false);
  steps.push(
    formBrowser('project_choose', 'click', '#project-flowark'),
    formBrowser('sync', 'click', '#sync-switch'),
    formBrowser('invoice_on', 'check', '#invoice-toggle', true),
  );
  fill('invoice', '#invoice-title', formExpected.invoiceTitle);
  fill('contact_name_1', '#contact-name-1', formExpected.contacts[0].name);
  fill('contact_email_1', '#contact-email-1', formExpected.contacts[0].email);
  steps.push(formBrowser('add_contact', 'click', '#add-contact'));
  fill('contact_name_2', '#contact-name-2', formExpected.contacts[1].name);
  fill('contact_email_2', '#contact-email-2', formExpected.contacts[1].email);
  steps.push(
    formBrowser('add_unused', 'click', '#add-contact'),
    formBrowser('remove_unused', 'click', '#contact-remove-3'),
    formBrowser('upload', 'upload', '#attachment', { binding: 'work', name: 'fictional.txt' }),
    formBrowser('before_submit', 'screenshot', ''),
    formBrowser('open_events', 'click', '#event-details-summary'),
    formBrowser('events_visible', 'wait', '#change-counts'),
    formBrowser('changes', 'read', '#change-counts'),
    {
      id: 'save_changes',
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'event-counts.json',
      content: { $ref: 'steps.changes' },
    },
    formBrowser('submit', 'click', '#submit'),
    formBrowser('receipt_ready', 'wait', '#submit-status[data-state="success"]'),
    formBrowser('receipt', 'read', '#server-result'),
    {
      id: 'save_receipt',
      type: 'file',
      version: 1,
      operation: 'write',
      binding: 'work',
      name: 'form-receipt.json',
      content: { $ref: 'steps.receipt' },
    },
    formBrowser('after_submit', 'screenshot', ''),
  );
  return {
    id: 'form-lab',
    formatVersion: '1.0',
    name: '复杂表单功能验证',
    description:
      '仅本地虚构数据：填写控件、读取当前值、提交后保存服务端回执。work 目录需放置 fictional.txt。',
    parameters: { baseUrl: url },
    requiredCapabilities: ['browser', 'browser-forms-v1', 'file', 'assert'],
    steps,
  };
}
