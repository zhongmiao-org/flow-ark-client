import type { RunReviewPreview } from '../shared/run-review';

export default function DesktopRunConfirmation({ preview }: { preview: RunReviewPreview }) {
  const desktop = preview.desktop!;
  return (
    <div className="desktop-run-confirmation" aria-label="本次选区修改">
      <p>
        {desktop.windowTitle
          ? `本机应用助手 · 文本编辑 / ${desktop.windowTitle}`
          : '重新选择本次 TextEdit 窗口与原选区后，才能确认修改。'}
      </p>
      <section className="desktop-confirm-original">
        <h2>原选区</h2>
        {desktop.original !== undefined ? (
          <pre tabIndex={0} aria-label="核对的原文">
            {desktop.original}
          </pre>
        ) : (
          <p>绑定窗口后显示本次核对的原文。</p>
        )}
      </section>
      <section className="desktop-confirm-replacement">
        <h2>修改为</h2>
        <pre tabIndex={0} aria-label="将替换的文字">
          {desktop.replacement}
        </pre>
      </section>
      <section className="desktop-confirm-scope">
        <h2>影响范围</h2>
        <p>
          只替换本次明确选择的原文，并读取修改后的文字核对。不会自动保存文档；不包含发送消息或操作其他窗口的步骤。
        </p>
      </section>
      <p>执行前再次核对窗口与原选区；发生变化或能力不可用时停止，结果未知不自动重放。</p>
      {desktop.expiresAt && (
        <p>
          绑定有效至 {new Date(desktop.expiresAt).toLocaleTimeString('zh-CN')}
          。运行期间请保持文档与选区不变。
        </p>
      )}
      {preview.rerun && <p>关联原运行：{preview.rerun.runId}。本次从头执行，可能再次修改文档。</p>}
      <details>
        <summary>查看固定方案与运行记录位置</summary>
        <p>
          {preview.flow.name} · {preview.flow.stepCount} 个步骤 ·{' '}
          {preview.debug ? '逐步调试' : '正常试运行'}
        </p>
        <p className="run-review-version">{preview.flow.versionId || '检查通过后固定执行版本'}</p>
        <p>本次运行和回执保存在本机。修改结果仍在原应用文档中，需要你按需保存文件。</p>
      </details>
    </div>
  );
}
