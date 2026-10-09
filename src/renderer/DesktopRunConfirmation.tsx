import { Alert, Collapse, Descriptions, Card } from 'antd';
import { activateCollapseWithSpace } from './collapseKeyboard';
import type { RunReviewPreview } from '../shared/run-review';

export default function DesktopRunConfirmation({ preview }: { preview: RunReviewPreview }) {
  const desktop = preview.desktop!;
  return (
    <div className="desktop-run-confirmation" aria-label="本次选区修改">
      <section>
        <Card size="small" className="desktop-confirm-card desktop-confirm-original">
          <h2>原选区</h2>
          {desktop.original !== undefined ? (
            <pre tabIndex={0} aria-label="核对的原文">
              {desktop.original}
            </pre>
          ) : (
            <p>绑定窗口后显示本次核对的原文。</p>
          )}
        </Card>
      </section>
      <section>
        <Card size="small" className="desktop-confirm-card desktop-confirm-replacement">
          <h2>修改为</h2>
          <pre tabIndex={0} aria-label="将替换的文字">
            {desktop.replacement}
          </pre>
        </Card>
      </section>
      <section>
        <Card size="small" className="desktop-confirm-card desktop-confirm-scope">
          <h2>影响范围</h2>
          <p>
            只替换本次明确选择的原文，并读取修改后的文字核对。不会自动保存文档；不包含发送消息或操作其他窗口的步骤。
          </p>
        </Card>
      </section>
      <Alert
        type="info"
        role="note"
        showIcon
        title="执行前再次核对窗口与原选区；发生变化或能力不可用时停止，结果未知不自动重放。"
      />
      {desktop.expiresAt && (
        <p>
          绑定有效至 {new Date(desktop.expiresAt).toLocaleTimeString('zh-CN')}
          。运行期间请保持文档与选区不变。
        </p>
      )}
      {preview.rerun && <p>关联原运行：{preview.rerun.runId}。本次从头执行，可能再次修改文档。</p>}
      <Collapse
        items={[
          {
            key: 'version',
            forceRender: true,
            onKeyDown: activateCollapseWithSpace,
            label: <>查看固定方案与运行记录位置</>,
            children: (
              <>
                <Descriptions
                  className="metadata-facts"
                  column={1}
                  bordered
                  size="small"
                  items={[
                    { key: 'flow', label: '方案', children: preview.flow.name },
                    { key: 'steps', label: '步骤数', children: preview.flow.stepCount },
                    {
                      key: 'mode',
                      label: '运行方式',
                      children: preview.debug ? '逐步调试' : '正常试运行',
                    },
                    {
                      key: 'version',
                      label: '版本',
                      children: preview.flow.versionId || '检查通过后固定执行版本',
                    },
                  ]}
                />
                <p>本次运行和回执保存在本机。修改结果仍在原应用文档中，需要你按需保存文件。</p>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
