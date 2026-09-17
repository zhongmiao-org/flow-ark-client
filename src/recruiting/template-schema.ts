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
      jobFilter: {
        type: 'object',
        title: '岗位筛选',
        description: '各组条件同时满足才允许动作；空列表不增加限制，未知信息进入待办。',
        additionalProperties: false,
        properties: {
          cities: {
            ...list('允许城市'),
            description: '与岗位页面的完整城市名称一致，不自动推断别名。',
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          includedCompanies: {
            ...list('包含公司'),
            description: '公司名称包含任一项即可；仍受排除公司限制。',
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          excludedKeywords: {
            ...list('排除职位词'),
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          workModes: {
            type: 'array',
            title: '允许工作方式',
            maxItems: 3,
            items: {
              type: 'string',
              oneOf: [
                { const: 'onsite', title: '现场办公' },
                { const: 'hybrid', title: '混合办公' },
                { const: 'remote', title: '远程办公' },
              ],
            },
          },
          salary: {
            type: 'object',
            title: '人民币月薪',
            additionalProperties: false,
            description: '核对页面的完整薪资区间；面议、年薪、日薪、时薪及其他币种需要人工核对。',
            properties: {
              enabled: { type: 'boolean', title: '启用月薪筛选' },
              minimumMonthly: {
                type: 'integer',
                title: '岗位月薪下限至少（元，0 不限）',
                minimum: 0,
                maximum: 100000000,
              },
              maximumMonthly: {
                type: 'integer',
                title: '岗位月薪上限至多（元，0 不限）',
                minimum: 0,
                maximum: 100000000,
              },
              currency: { const: 'CNY' },
            },
            required: ['enabled', 'minimumMonthly', 'maximumMonthly', 'currency'],
          },
        },
        required: ['cities', 'includedCompanies', 'excludedKeywords', 'workModes', 'salary'],
      },
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
