import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Input, Modal, Select, Table, Tag } from 'antd';
import type {
  CacheCategory,
  CacheItem,
  CachePreview,
  CacheResult,
  CacheScan,
} from '../shared/cache-management';
import './cache-settings.css';

const api = (method: string, args: unknown = {}): Promise<any> =>
  window.flowark.request(method, args);
const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
const categories: Record<CacheCategory, string> = {
  temporary: '调试临时文件',
  log: '日志',
  profile: '性能采样',
  'test-copy': '测试副本',
  compiled: '编译残留',
  unverified: '待确认',
};
const statuses = {
  ready: '可清理',
  active: '正在使用',
  protected: '受保护',
  unverified: '待确认',
  blocked: '不可清理',
};

export default function CacheSettingsPanel({ openRuns }: { openRuns: () => void }) {
  const [root, setRoot] = useState('');
  const [scan, setScan] = useState<CacheScan>();
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<CachePreview>();
  const [reviewed, setReviewed] = useState(false);
  const [adopting, setAdopting] = useState<CacheItem>();
  const [purpose, setPurpose] = useState('');
  const [category, setCategory] = useState<CacheCategory>('temporary');
  const [ownership, setOwnership] = useState(false);
  const [history, setHistory] = useState<CacheResult[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void Promise.all([api('cache.locations'), api('cache.status')])
      .then(([location, records]) => {
        if (live.current) {
          setRoot(location.current);
          setHistory(records);
        }
      })
      .catch((e) => {
        if (live.current) setError(String(e));
      });
    return () => {
      live.current = false;
    };
  }, []);
  const act = async (label: string, operation: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(label);
    setError('');
    try {
      await operation();
    } catch (e) {
      if (live.current)
        setError(
          String(e).replace(/^Error: Error invoking remote method 'flowark:request': Error: /, ''),
        );
    } finally {
      locked.current = false;
      if (live.current) setBusy('');
    }
  };
  const scanFiles = async () => {
    const next: CacheScan = await api('cache.scan');
    if (!live.current) return;
    setScan(next);
    setRoot(next.root);
    setSelected(next.items.filter((i) => i.status === 'ready').map((i) => i.id));
    setPreview(undefined);
  };
  const reveal = (id: string) =>
    void act('打开位置', async () => {
      await api('cache.reveal', { scanId: scan!.id, id });
    });
  const clearing = busy === '清理';
  return (
    <section className="cache-settings" aria-label="缓存与调试文件">
      <Card>
        <h2>缓存与调试文件</h2>
        <p>
          核对用途和实际路径后清理。正式实例、流程、Skill、凭据、登录态、业务数据、外发账本、备份和用户导出文件不属于缓存。
        </p>
        <p className="cache-path">
          调试文件保存位置：<strong>{root || '正在读取…'}</strong>
        </p>
        <div className="cache-actions">
          <Button
            disabled={!!busy}
            onClick={() =>
              void act('更改位置', async () => {
                const next = await api('cache.location');
                if (next && live.current) {
                  setRoot(next.current);
                  setScan(undefined);
                  setSelected([]);
                }
              })
            }
          >
            更改位置
          </Button>
          <Button
            disabled={!!busy}
            onClick={() =>
              void act('打开位置', async () => {
                await api('cache.root');
              })
            }
          >
            打开位置
          </Button>
          <Button
            type="primary"
            loading={busy === '扫描'}
            disabled={!!busy && busy !== '扫描'}
            onClick={() => void act('扫描', scanFiles)}
          >
            扫描
          </Button>
          <Button disabled={!!busy} onClick={openRuns}>
            按运行清理产物
          </Button>
        </div>
        <p className="cache-muted">
          更改位置只影响后续调试文件，原目录继续可扫描。旧文件不会自动移动或删除；/tmp 与
          /private/tmp 合并统计。
        </p>
        {busy && <p role="status">正在{busy}… 请等待结果。</p>}
        {error && (
          <Alert
            type="error"
            showIcon
            title="操作未确认完成"
            description={error}
            action={
              <Button
                disabled={!!busy}
                onClick={() =>
                  void act('读取结果', async () => {
                    setHistory(await api('cache.status'));
                  })
                }
              >
                核对保存的清理结果
              </Button>
            }
          />
        )}
        {scan && (
          <>
            {scan.warnings.map((warning) => (
              <Alert key={warning} type="warning" showIcon title={warning} />
            ))}
            <p role="status">
              扫描完成 · {scan.items.length} 项 · {scan.items.reduce((n, i) => n + i.files, 0)}{' '}
              个文件 · 占用 {size(scan.items.reduce((n, i) => n + i.allocatedBytes, 0))} · 已选{' '}
              {selected.length} 项
            </p>
            <p className="cache-muted cache-path">扫描位置：{scan.roots.join('；')}</p>
            <Table<CacheItem>
              rowKey="id"
              dataSource={scan.items}
              size="small"
              pagination={{ pageSize: 20, showSizeChanger: false }}
              rowSelection={{
                selectedRowKeys: selected,
                onChange: (keys) => setSelected(keys.map(String)),
                getCheckboxProps: (item) => ({
                  disabled: !!busy || item.status !== 'ready',
                  'aria-label': `选择缓存：${item.path}`,
                }),
              }}
              columns={[
                {
                  title: '分类与用途',
                  key: 'purpose',
                  render: (_, i) => (
                    <>
                      <strong>{categories[i.category]}</strong>
                      <p>{i.purpose}</p>
                    </>
                  ),
                },
                {
                  title: '实际路径',
                  dataIndex: 'path',
                  key: 'path',
                  render: (path) => <span className="cache-path">{path}</span>,
                },
                {
                  title: '数量 / 占用',
                  key: 'size',
                  render: (_, i) => (
                    <>
                      {i.files} 个文件<p>{size(i.allocatedBytes)}</p>
                    </>
                  ),
                },
                {
                  title: '状态',
                  key: 'status',
                  render: (_, i) => (
                    <>
                      <Tag
                        color={
                          i.status === 'ready'
                            ? 'success'
                            : i.status === 'unverified'
                              ? 'warning'
                              : 'default'
                        }
                      >
                        {statuses[i.status]}
                      </Tag>
                      <p>{i.reason}</p>
                    </>
                  ),
                },
                {
                  title: '操作',
                  key: 'actions',
                  render: (_, i) => (
                    <div className="cache-actions">
                      <Button size="small" disabled={!!busy} onClick={() => reveal(i.id)}>
                        打开位置
                      </Button>
                      {i.status === 'unverified' && (
                        <Button
                          size="small"
                          disabled={!!busy}
                          onClick={() => {
                            setAdopting(i);
                            setPurpose('');
                            setOwnership(false);
                            setCategory(i.category === 'unverified' ? 'temporary' : i.category);
                          }}
                        >
                          核对用途
                        </Button>
                      )}
                    </div>
                  ),
                },
              ]}
            />
            <Button disabled={!!busy || !selected.length} onClick={() => setSelected([])}>
              清空选择
            </Button>
            <Button
              danger
              disabled={!!busy || !selected.length}
              onClick={() =>
                void act('预览', async () => {
                  const next = await api('cache.preview', { scanId: scan.id, ids: selected });
                  setReviewed(false);
                  setPreview(next);
                })
              }
            >
              清除所选（{selected.length}）
            </Button>
          </>
        )}
        {!scan && <p className="cache-muted">点击“扫描”查看可管理文件。扫描和预览不会删除文件。</p>}
      </Card>
      <Modal
        title="确认清理缓存"
        open={!!preview}
        width={880}
        maskClosable={false}
        onCancel={() => !clearing && setPreview(undefined)}
        cancelButtonProps={{ disabled: clearing }}
        closable={!clearing}
        confirmLoading={clearing}
        okText="已核对，开始清理"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: !!busy || !reviewed }}
        onOk={() =>
          void act('清理', async () => {
            const result = await api('cache.clear', { token: preview!.token, reviewed: true });
            setHistory((previous) => [result, ...previous.filter((r) => r.id !== result.id)]);
            setPreview(undefined);
            setSelected([]);
          })
        }
      >
        <p>
          {preview?.items.length} 项 · {preview?.files.length} 个文件 · 预计清除占用{' '}
          {size(preview?.bytes ?? 0)}
        </p>
        <p>
          执行时再次核对身份、路径、引用和活动占用。不会跟随链接；权限失败会保留原文件，不尝试提权。
        </p>
        <Table
          rowKey="path"
          size="small"
          dataSource={preview?.files ?? []}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          columns={[
            {
              title: '完整清单',
              dataIndex: 'path',
              render: (path) => <span className="cache-path">{path}</span>,
            },
            { title: '大小', dataIndex: 'bytes', render: size },
            {
              title: '类型',
              dataIndex: 'link',
              render: (link) => (link ? '链接本身（不访问目标）' : '文件'),
            },
          ]}
        />
        <Checkbox
          checked={reviewed}
          disabled={!!busy}
          onChange={(e) => setReviewed(e.target.checked)}
        >
          我已核对清单，确认所选项目只用于调试，可以清理
        </Checkbox>
      </Modal>
      <Modal
        title="核对旧调试文件用途"
        open={!!adopting}
        onCancel={() => !busy && setAdopting(undefined)}
        confirmLoading={!!busy}
        okText="登记用途并重新扫描"
        cancelText="取消"
        okButtonProps={{ disabled: !!busy || !ownership || purpose.trim().length < 3 }}
        onOk={() =>
          void act('登记用途', async () => {
            await api('cache.adopt', {
              scanId: scan!.id,
              id: adopting!.id,
              purpose,
              category,
              reviewed: true,
            });
            setAdopting(undefined);
            await scanFiles();
          })
        }
      >
        <p className="cache-path">{adopting?.path}</p>
        <p>文件名不能证明用途。请先打开位置核对来源；不确定时取消并保留。</p>
        <label>
          用途说明
          <Input value={purpose} maxLength={300} onChange={(e) => setPurpose(e.target.value)} />
        </label>
        <label>
          分类
          <Select<CacheCategory>
            value={category}
            onChange={setCategory}
            options={(['temporary', 'log', 'profile', 'test-copy'] as const).map((value) => ({
              value,
              label: categories[value],
            }))}
          />
        </label>
        <Checkbox checked={ownership} onChange={(e) => setOwnership(e.target.checked)}>
          已核对来源；此项仅为已结束的调试资料，未包含需要保留的正式文件、备份或用户导出
        </Checkbox>
      </Modal>
      {history.length > 0 && (
        <p className="cache-muted">
          已删除占用按成功删除文件的分配块计算；磁盘可用空间变化同时受其他应用写入和系统回收影响。中断时只显示已保存的结果，不自动重试。
        </p>
      )}
      {history.map((result) => (
        <Card
          key={result.id}
          title={
            result.state === 'interrupted'
              ? '上次清理已中断，请重新扫描'
              : result.state === 'pending'
                ? '清理结果尚未确认，请重新扫描核对剩余文件'
                : '清理结果'
          }
        >
          <p role="status">
            成功 {result.results.filter((r) => r.status === 'success').length} · 失败{' '}
            {result.results.filter((r) => r.status === 'failed').length} · 跳过{' '}
            {result.results.filter((r) => r.status === 'skipped').length} · 已删除文件分配占用{' '}
            {size(result.results.reduce((n, r) => n + r.releasedBytes, 0))}
          </p>
          <Table
            rowKey="id"
            dataSource={result.results}
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: false }}
            columns={[
              {
                title: '项目',
                dataIndex: 'path',
                render: (path) => <span className="cache-path">{path}</span>,
              },
              {
                title: '结果',
                dataIndex: 'status',
                render: (value) =>
                  ({ success: '成功', failed: '失败', skipped: '跳过' })[value as string],
              },
              { title: '原因', dataIndex: 'reason' },
              { title: '已删除占用', dataIndex: 'releasedBytes', render: size },
              {
                title: '磁盘可用空间变化',
                dataIndex: 'availableBytesChange',
                render: (value) =>
                  value === undefined
                    ? '未确认'
                    : `${value < 0 ? '-' : '+'}${size(Math.abs(value))}`,
              },
              {
                title: '操作',
                render: (_, row) =>
                  scan?.items.some((i) => i.id === row.id) ? (
                    <Button size="small" disabled={!!busy} onClick={() => reveal(row.id)}>
                      打开位置
                    </Button>
                  ) : (
                    '重新扫描后可打开位置'
                  ),
              },
            ]}
          />
        </Card>
      ))}
    </section>
  );
}
