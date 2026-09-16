/** Distributed with each template package, never embedded in the editor panel. */
export function recruitingConfigurationSchema(platform: 'boss' | 'zhaopin') {
  const text = (title: string) => ({ type: 'string', title, maxLength: 1000 });
  const list = (title: string) => ({
    type: 'array',
    title,
    items: { type: 'string' },
    maxItems: 1000,
  });
  const actionLabels = {
    apply: '投递 / 发起沟通',
    resume: '发送指定简历',
    reply: 'AI 回复',
    requestWechat: '请求微信',
    acceptWechat: '接受微信',
    requestPhone: '请求手机号',
    acceptPhone: '接受手机号',
  };
  return {
    type: 'object',
    title: '账号与动作授权',
    description: '配置仅属于当前实例，不随模板导出。真实页面适配完成前不执行外发。',
    additionalProperties: true,
    properties: {
      platform: { const: platform },
      account: text('求职者账号标识'),
      resumeVersion: text('简历版本 / 摘要'),
      resumeBinding: text('简历本地绑定'),
      keywords: list('职位关键词'),
      excludedCompanies: list('排除公司'),
      allowedTargets: list('允许的岗位 / 会话 ID'),
      actions: {
        type: 'object',
        title: '逐项动作权限',
        additionalProperties: false,
        properties: Object.fromEntries(
          Object.entries(actionLabels).map(([key, title]) => [
            key,
            {
              type: 'string',
              title,
              oneOf: [
                { const: 'deny', title: '禁止' },
                { const: 'confirm', title: '需要确认' },
                { const: 'auto', title: '配置范围内自动' },
              ],
            },
          ]),
        ),
        required: Object.keys(actionLabels),
      },
      ownWechat: text('允许分享的本人微信'),
      ownPhone: text('允许分享的本人手机号'),
      dailyLimit: { type: 'integer', title: '每日动作上限', minimum: 1, maximum: 500 },
      batchLimit: { type: 'integer', title: '每轮动作上限', minimum: 1, maximum: 30 },
      startHour: { type: 'integer', title: '开始时间（小时）', minimum: 0, maximum: 23 },
      endHour: { type: 'integer', title: '结束时间（小时）', minimum: 1, maximum: 24 },
      timezone: text('时区'),
      provider: {
        type: 'string',
        title: 'AI Provider',
        oneOf: [
          { const: 'openai-codex', title: 'Codex · Responses API' },
          { const: 'deepseek', title: 'DeepSeek · Chat Completions' },
        ],
      },
      model: text('模型 ID'),
      facts: {
        type: 'array',
        title: '授权事实',
        description: '只填写允许对外使用的事实，未知内容进入人工待办。',
        maxItems: 1000,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { id: text('事实 ID'), text: text('事实内容') },
          required: ['id', 'text'],
        },
      },
    },
  };
}
