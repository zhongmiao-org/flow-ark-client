import { useEffect, useRef } from 'react';
import './ai-state-guide.css';

export default function AIStateGuide({
  provider,
  back,
  settings,
  configuration,
  attention,
  editable,
}: {
  provider: string;
  back: () => void;
  settings: () => void;
  configuration: (field?: 'model' | 'key' | 'status') => void;
  attention: () => void;
  editable: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.querySelector('main')?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, []);
  const cards = [
    {
      status: '已保存 · 鉴权失败',
      tone: 'error',
      title: '密钥不可用',
      description: `本机保留已保存配置。请核对 ${provider} Key 和账号权限，再明确重试。`,
      action: '查看当前连接详情',
      primary: true,
      run: () => configuration('status'),
    },
    {
      status: '已保存 · 请求受限',
      tone: 'warning',
      title: '配额不足或限流',
      description: '处理账号额度或稍后主动重试。保留 Key，不自动切换供应商或模型。',
      action: '返回设置',
      run: settings,
    },
    {
      status: '已保存 · 未完成测试',
      tone: 'neutral',
      title: '网络超时或取消',
      description: '配置仍然保留，尚未取得完整验证结果。先查看当前连接，再决定是否重新测试。',
      action: '查看连接并重试',
      primary: true,
      run: () => configuration('status'),
    },
    {
      status: '检查模型 ID',
      tone: 'error',
      title: '模型或请求不可用',
      description: '核对当前账号可用的模型与请求要求；保留原配置，不静默切换模型。',
      action: '修改模型 ID',
      disabled: !editable,
      run: () => configuration('model'),
    },
    {
      status: '保存失败',
      tone: 'error',
      title: '凭据保护不可用',
      description: '未写入新 Key，不降级为明文；替换失败保留旧 Key。返回配置后核对原因再重试。',
      action: '返回配置',
      primary: true,
      run: () => configuration(),
    },
    {
      status: '需要核对输出',
      tone: 'warning',
      title: '输出格式不符合要求',
      description:
        '连接成功不代表业务输出有效。按实际失败记录核对结构、事实和动作授权；没有待办不代表通过。',
      action: '查看待办',
      run: attention,
    },
  ];
  return (
    <div className="ai-settings-host ai-state-guide-host">
      <header className="topbar">
        <button className="context-back" onClick={back}>
          ← 返回 AI 服务配置
        </button>
        <nav className="breadcrumbs" aria-label="当前位置">
          <a
            href="#settings"
            onClick={(event) => {
              event.preventDefault();
              settings();
            }}
          >
            本地设置
          </a>
          <span aria-hidden="true">/</span>
          <a
            href="#ai-settings"
            onClick={(event) => {
              event.preventDefault();
              back();
            }}
          >
            AI 服务配置
          </a>
          <span aria-hidden="true">/</span>
          <span aria-current="page">AI 连接与输出状态</span>
        </nav>
      </header>
      <section className="page ai-task-page ai-state-guide">
        <div className="page-heading">
          <div>
            <h1 ref={heading} tabIndex={-1}>
              AI 连接与输出状态
            </h1>
            <p>
              状态说明 · 以下是常见情况，不代表当前账号状态。实际结果请查看 {provider}{' '}
              配置或任务记录。
            </p>
          </div>
        </div>
        <div className="ai-state-guide-grid">
          {cards.map((card) => (
            <article
              className="ai-task-card ai-state-guide-card"
              key={card.title}
              aria-label={card.title + '说明'}
            >
              <span className={'ai-config-status ' + card.tone}>{card.status}</span>
              <h2>{card.title}</h2>
              <p>{card.description}</p>
              <button
                className={card.primary ? 'primary' : undefined}
                disabled={card.disabled}
                onClick={card.run}
                title={card.disabled ? '请等待当前配置可编辑后再修改' : undefined}
              >
                {card.action}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
