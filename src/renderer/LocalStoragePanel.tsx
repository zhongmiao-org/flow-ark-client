import { Card, Empty, Button, Collapse, Input } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import { useRef, useState } from 'react';
import type { Bootstrap, FlowRecord } from '../shared/types';
import './local-storage.css';

type Resource = { key: string; name: string; kind: string; usage: string; path?: string };
const usage = { read: '声明读取', write: '声明写入', readwrite: '声明读写', use: '声明使用' };

function resourcesFor(flow: FlowRecord, templates: Bootstrap['templates']): Resource[] {
  const binding = flow.bindings.template;
  const manifest = templates.find((item) => item.key === binding?.packageKey)?.manifest;
  const entry = manifest?.entries.find((item) => item.id === binding?.entryId);
  const resources: Resource[] = Object.entries(flow.bindings.files).map(([name, path]) => ({
    key: `directory:${name}`,
    name,
    path,
    kind: '目录',
    usage: '按流程步骤使用',
  }));
  const ids = new Set([
    ...Object.entries(flow.bindings.resources ?? {})
      .filter(([, item]) => item.path !== undefined)
      .map(([id]) => id),
    ...(manifest?.resources
      .filter(
        (item) => entry?.resources.includes(item.id) && ['file', 'directory'].includes(item.kind),
      )
      .map((item) => item.id) ?? []),
  ]);
  for (const id of ids) {
    const declaration = manifest?.resources.find((item) => item.id === id);
    resources.push({
      key: `resource:${id}`,
      name: declaration ? `${declaration.name} · ${id}` : id,
      path: flow.bindings.resources?.[id]?.path,
      kind:
        declaration?.kind === 'file'
          ? '文件'
          : declaration?.kind === 'directory'
            ? '目录'
            : '本机资源',
      usage: declaration ? usage[declaration.access] : '用途声明暂不可用',
    });
  }
  return resources;
}

export default function LocalStoragePanel({
  compact = false,
  data,
  busy,
  openFlow,
  showData,
  openRuns,
}: {
  compact?: boolean;
  data: Bootstrap;
  busy: boolean;
  openFlow: (flow: FlowRecord) => void;
  showData: () => void;
  openRuns: () => void;
}) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const inventory = data.flows
    .map((flow) => ({ flow, resources: resourcesFor(flow, data.templates) }))
    .filter((item) => item.resources.length);
  const needle = query.trim().toLocaleLowerCase();
  const filtered = inventory
    .map(({ flow, resources }) => ({
      flow,
      resources: flow.flow.name.toLocaleLowerCase().includes(needle)
        ? resources
        : resources.filter((resource) =>
            `${resource.name} ${resource.path ?? ''}`.toLocaleLowerCase().includes(needle),
          ),
    }))
    .filter((item) => item.resources.length);
  const count = filtered.reduce((sum, item) => sum + item.resources.length, 0);
  const searchControls = (
    <>
      <label className="local-settings-search">
        搜索本机资源
        <Input
          size={compact ? 'small' : undefined}
          ref={(instance) => {
            search.current = instance?.input ?? null;
          }}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="流程名称、资源名称或路径"
        />
      </label>
      <div className="local-storage-count" role="status">
        {filtered.length} 个流程 · {count} 项资源
      </div>
    </>
  );
  const dataLocation = (
    <>
      <p className="local-settings-path">{data.dataPath || '正在初始化安全存储…'}</p>
      <Button disabled={busy || !data.dataPath || undefined} onClick={showData}>
        打开数据目录
      </Button>
    </>
  );
  const resourceHelp = (
    <>
      {compact && (
        <p className="local-settings-muted">
          用途来自模板声明，选择路径不等于授权执行；已保存路径是否可用，会在运行前重新检查。
        </p>
      )}
      <p className="local-settings-muted">
        本地路径和凭据不随流程 ZIP 导出。外部输出文件与应用内副本的状态，以对应运行的产物记录为准。
      </p>
    </>
  );
  return (
    <div className={`local-storage-layout${compact ? ' is-compact' : ''}`}>
      <section>
        <Card
          className="local-settings-card local-storage-bindings"
          variant={compact ? 'borderless' : 'outlined'}
          styles={compact ? { body: { padding: 0 } } : undefined}
        >
          <h2>{compact ? '文件与存储' : '文件与目录绑定'}</h2>
          <p>本地路径只保存在这台 Mac 上。重新选择位置，请打开所属流程的资源配置。</p>
          {compact ? (
            <Collapse
              className="local-resource-search-controls"
              size="small"
              activeKey={searchOpen ? ['search'] : []}
              onChange={(keys) => setSearchOpen(keys.includes('search'))}
              items={[
                {
                  key: 'search',
                  label: `查找本机资源 · ${count}`,
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  children: searchControls,
                },
              ]}
            />
          ) : (
            searchControls
          )}
          {filtered.map(({ flow, resources }) => (
            <article className="local-settings-resource" key={flow.id}>
              <div className="local-settings-row">
                <h3>{flow.flow.name}</h3>
                <Button
                  disabled={busy || undefined}
                  onClick={() => openFlow(flow)}
                  aria-label={`配置 ${flow.flow.name} 的资源`}
                >
                  打开流程配置
                </Button>
              </div>
              <ul className="local-storage-resources">
                {resources.map((resource) => (
                  <li key={resource.key}>
                    <div className="local-storage-resource-title">
                      <strong>{resource.name}</strong>
                      <span>{resource.kind}</span>
                    </div>
                    <span className="local-storage-usage">{resource.usage}</span>
                    <p className={`local-settings-path${resource.path ? '' : ' is-unbound'}`}>
                      {resource.path || '尚未选择本机位置'}
                    </p>
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {!filtered.length && (
            <Empty
              className="local-settings-empty"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                needle ? '没有匹配的资源。' : '尚无文件或目录资源。可在流程配置中选择本机位置。'
              }
            >
              {needle && (
                <Button
                  onClick={() => {
                    setQuery('');
                    setSearchOpen(true);
                    requestAnimationFrame(() => search.current?.focus());
                  }}
                >
                  清除搜索
                </Button>
              )}
            </Empty>
          )}
          {!compact && (
            <p className="local-settings-muted">
              用途来自模板声明，选择路径不等于授权执行；已保存路径是否可用，会在运行前重新检查。
            </p>
          )}
        </Card>
      </section>
      <section>
        <Card
          className="local-settings-card local-storage-locations"
          variant={compact ? 'borderless' : 'outlined'}
          styles={compact ? { body: { padding: 0 } } : undefined}
        >
          {!compact && <h2>文件与存储</h2>}
          <div className="local-storage-location">
            <h3>应用内产物</h3>
            <p>
              {compact
                ? '按运行独立保存。'
                : '按运行独立保存。进入运行详情的“输出 / 产物”，查看文件状态、保存位置或清理预览。'}
            </p>
            <Button
              type={compact ? 'default' : 'primary'}
              disabled={busy || undefined}
              onClick={openRuns}
            >
              查看运行与产物
            </Button>
          </div>
          {compact ? (
            <Collapse
              className="local-storage-details"
              size="small"
              items={[
                {
                  key: 'data',
                  label: '本地数据目录',
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  children: dataLocation,
                },
                {
                  key: 'help',
                  label: '资源使用说明',
                  forceRender: true,
                  onKeyDown: activateCollapseWithSpace,
                  children: resourceHelp,
                },
              ]}
            />
          ) : (
            <>
              <div className="local-storage-location">
                <h3>本地数据目录</h3>
                {dataLocation}
              </div>
              {resourceHelp}
            </>
          )}
        </Card>
      </section>
    </div>
  );
}
