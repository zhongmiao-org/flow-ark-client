import { useLayoutEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Select, Tag } from 'antd';
import type { InstalledPackage } from '../templates/archive';
import type {
  TemplateResourceExtensionApplyRequest,
  TemplateResourceExtensionApplyResponse,
  TemplateResourceExtensionPreviewRequest,
  TemplateResourceExtensionPreviewResponse,
  TemplateResourceExtensionReceipt,
} from '../shared/contracts.generated';
import type { TemplateDetail } from './template-draft';
import TechnicalDetails from './TechnicalDetails';

const api = (method: string, args: unknown): Promise<any> => window.flowark.request(method, args);
const message = (error: unknown) =>
  (error instanceof Error ? error.message : '暂时未取得结果，请重新核对').replace(
    /^Error invoking remote method 'flowark:request': (?:Error: )?/,
    '',
  );

export default function TemplateResourceExtension({
  detail,
  packages,
  blocked,
  readBlocked,
  dirty,
  hasDraft,
  work,
  accept,
  configure,
}: {
  detail: TemplateDetail;
  packages: InstalledPackage[];
  blocked: boolean;
  readBlocked: boolean;
  dirty: boolean;
  hasDraft: () => boolean;
  work: (fn: () => Promise<any>, notice?: string) => Promise<any>;
  accept: (next: TemplateDetail) => void;
  configure: () => void;
}) {
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<TemplateResourceExtensionPreviewResponse>();
  const [request, setRequest] = useState<TemplateResourceExtensionApplyRequest>();
  const [received, setReceived] = useState<TemplateResourceExtensionReceipt>();
  const [refreshPending, setRefreshPending] = useState(false);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<'preview' | 'apply' | 'refresh'>();
  const currentOperation = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  const [returnFocus, setReturnFocus] = useState(false);
  useLayoutEffect(() => {
    if (!returnFocus || phase || readBlocked) return;
    setReturnFocus(false);
    const current = origin.current;
    if (
      !heading.current?.closest('[hidden]') &&
      (document.activeElement === document.body || document.activeElement === current)
    ) {
      const target =
        current?.isConnected && !current.matches(':disabled') ? current : heading.current;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
    }
  }, [returnFocus, phase, readBlocked]);
  const receipt = received ?? detail.resourceExtension;
  const choices = packages.filter(
    (pkg) => pkg.manifest.id === detail.manifest.id && pkg.key !== detail.instance.packageKey,
  );
  const candidate = choices.find((pkg) => pkg.key === selected);
  const selection = (): TemplateResourceExtensionPreviewRequest => {
    if (request) {
      const { requestId: _requestId, ...original } = request;
      return original;
    }
    if (!candidate) throw Error('请先选择目录声明来源版本。');
    return {
      version: 1,
      instanceId: detail.instance.id,
      expectedRevision: detail.revision,
      basePackage: {
        id: detail.manifest.id,
        version: detail.manifest.version,
        digest: detail.manifest.contentDigest,
      },
      extensionPackage: {
        id: candidate.manifest.id,
        version: candidate.manifest.version,
        digest: candidate.manifest.contentDigest,
      },
    };
  };
  const refresh = async (fixed: TemplateResourceExtensionReceipt) => {
    setPhase('refresh');
    setRefreshPending(true);
    const next: TemplateDetail = await api('template.detail', { id: fixed.instanceId });
    if (
      next.instance.id !== detail.instance.id ||
      next.instance.packageKey !== detail.instance.packageKey ||
      next.resourceExtension?.receiptSha256 !== fixed.receiptSha256
    )
      throw Error('尚未读到本次目录接入的准确实例，请重新读取。');
    accept(next);
    setRefreshPending(false);
  };
  const perform = async (nextPhase: 'preview' | 'apply' | 'refresh', fn: () => Promise<void>) => {
    if (currentOperation.current || (nextPhase === 'apply' ? blocked : readBlocked)) return;
    currentOperation.current = true;
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPhase(nextPhase);
    setError('');
    try {
      await work(async () => {
        try {
          await fn();
        } catch (error) {
          setError(message(error));
        }
      });
    } finally {
      currentOperation.current = false;
      setPhase(undefined);
      setReturnFocus(true);
    }
  };
  const inspect = () =>
    perform('preview', async () => {
      const next: TemplateResourceExtensionPreviewResponse = await api(
        'template.resourceExtension.preview',
        selection(),
      );
      setPreview(next);
      if (next.status === 'already-applied') {
        setReceived(next.receipt);
        await refresh(next.receipt);
      }
    });
  const apply = () =>
    perform('apply', async () => {
      if (hasDraft()) throw Error('当前还有未保存或未完成的输入，请先保存；输入仍保留。');
      if (preview?.status !== 'compatible' || preview.expectedRevision !== detail.revision)
        throw Error('实例或选择已变化，请重新检查目录声明。');
      const fixed: TemplateResourceExtensionApplyRequest = request ?? {
        ...selection(),
        requestId: crypto.randomUUID(),
      };
      setRequest(fixed);
      // An uncertain response requires a read-only status check before another write.
      setPreview(undefined);
      const response: TemplateResourceExtensionApplyResponse = await api(
        'template.resourceExtension.apply',
        fixed,
      );
      setReceived(response.receipt);
      await refresh(response.receipt);
    });
  const additions = receipt ?? (preview?.status === 'compatible' ? preview : undefined);
  const missing = receipt?.resources.filter(
    (resource) => !detail.instance.resources[resource.id]?.path,
  );
  const compatible =
    preview?.status === 'compatible' && preview.expectedRevision === detail.revision;
  return (
    <div className="template-version-adoption" aria-busy={!!phase}>
      <Tag
        className="run-state-tag"
        variant="filled"
        color={receipt ? 'success' : 'default'}
        icon={<Badge status={receipt ? 'success' : 'default'} />}
      >
        {phase === 'apply'
          ? '正在接入'
          : receipt
            ? '目录声明已接入'
            : compatible
              ? '可原地接入'
              : '原实例接入'}
      </Tag>
      <h3 ref={heading} tabIndex={-1}>
        接入目录资源声明
      </h3>
      <p>仅接入新增目录的资源声明。原模板、本地编排、业务状态及固定结果来源保持。</p>
      <p>当前实例继续使用固定版本 v{detail.manifest.version}。</p>
      {!receipt && (
        <>
          <label className="ai-settings-field">
            目录声明来源版本
            <Select<string>
              aria-label="目录声明来源版本"
              disabled={blocked || !!request}
              value={selected}
              onChange={(value) => {
                setSelected(value);
                setPreview(undefined);
                setError('');
              }}
              options={[
                { value: '', label: '选择已安装版本' },
                ...choices.map((pkg) => ({ value: pkg.key, label: `v${pkg.manifest.version}` })),
              ]}
            />
          </label>
          {!choices.length && <p>尚无其他已安装版本，请先从模板库导入目录声明包。</p>}
          <Button disabled={readBlocked || (!candidate && !request)} onClick={() => void inspect()}>
            {phase === 'preview' ? '正在检查…' : request ? '核对接入状态' : '检查目录声明'}
          </Button>
        </>
      )}
      {additions && (
        <Alert
          className="template-version-summary"
          type={receipt ? (refreshPending || missing?.length ? 'warning' : 'success') : 'info'}
          showIcon
          role="status"
          title={
            receipt
              ? refreshPending
                ? '目录声明已接入，等待读取实例'
                : missing?.length
                  ? '缺少目录绑定'
                  : '目录声明已接入'
              : '可原地接入'
          }
          description={
            <div className="feedback-body">
              <p>
                {additions.resources
                  .map(
                    (resource) =>
                      `${resource.name}（${resource.access === 'readwrite' ? '读写' : '写入'}）`,
                  )
                  .join('、')}
              </p>
              <p>
                使用入口：
                {additions.entries
                  .map(
                    (entry) =>
                      detail.entries.find((item) => item.id === entry.entryId)?.name ??
                      entry.entryId,
                  )
                  .join('、')}
              </p>
              {refreshPending && <p>已保留接入回执。重新读取实例即可继续绑定目录。</p>}
              {!refreshPending && missing?.length ? (
                <p>选择目录并保存绑定后，相关操作入口才可运行。</p>
              ) : null}
            </div>
          }
        />
      )}
      {phase === 'apply' && (
        <Alert
          className="template-version-summary"
          type="info"
          role="status"
          showIcon
          title="正在保存目录声明"
          description="正在核对固定来源和实例修订并保存。完成前保留当前页面，避免重复操作。"
        />
      )}
      {preview && (preview.status === 'incompatible' || preview.status === 'blocked') && (
        <Alert
          className="template-version-summary"
          type="warning"
          role="status"
          showIcon
          title={preview.status === 'incompatible' ? '不能原地接入目录声明' : '暂时无法接入'}
          description={preview.reason}
        />
      )}
      {dirty && !receipt && <p role="status">当前有未保存或未完成的输入，请先保存；输入仍保留。</p>}
      {error && (
        <Alert
          className="template-version-summary"
          type="error"
          role="alert"
          showIcon
          title={
            receipt ? '已接入，实例读取未完成' : request ? '接入结果待核对' : '目录声明检查未完成'
          }
          description={error}
        />
      )}
      {!receipt && (compatible || phase === 'apply') && (
        <Button type="primary" disabled={blocked || dirty || !!phase} onClick={() => void apply()}>
          {phase === 'apply' ? '正在接入…' : '接入新增资源'}
        </Button>
      )}
      {receipt && (
        <>
          <Button
            type="primary"
            disabled={refreshPending ? readBlocked : blocked}
            onClick={() => {
              if (refreshPending) void perform('refresh', () => refresh(receipt));
              else configure();
            }}
          >
            {phase === 'refresh' ? '正在读取…' : refreshPending ? '重新读取实例' : '配置目录资源'}
          </Button>
          <TechnicalDetails
            items={[
              { label: '目录声明来源版本', value: receipt.extensionPackage.version },
              { label: '接入回执摘要', value: receipt.receiptSha256 },
            ]}
          />
        </>
      )}
    </div>
  );
}
