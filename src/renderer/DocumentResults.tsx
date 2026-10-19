import { useState } from 'react';
import { Alert, Card, Collapse, Descriptions, Select, Tag } from 'antd';
import type { Flow, Step } from '../shared/types';
import { assertDocumentResult, type DocumentResult } from '../shared/document';
import './document-results.css';
export function DocumentResultView({ value }: { value: DocumentResult }) {
  const [index, setIndex] = useState(1);
  const unit = value.units[Math.min(index, value.units.length) - 1];
  return (
    <section className="document-result" aria-label="资料解析结果">
      <Alert
        showIcon
        type={value.status === 'ready' ? 'info' : 'warning'}
        title={
          value.status === 'ready'
            ? '提取范围已完成，请核对内容'
            : value.status === 'empty'
              ? '没有可采用正文，请核对资料'
              : '内容存在缺口，需要人工核对'
        }
        description="解析成功仅表示本次提取范围完成，不代表事实已确认。不会自动发送给模型。"
      />
      <div className="document-result-columns">
        <Card title="来源与状态">
          <Tag>{value.status}</Tag>
          <Descriptions
            column={1}
            layout="vertical"
            items={[
              { key: 'name', label: '相对来源', children: value.source.name },
              { key: 'binding', label: '逻辑目录', children: value.source.binding },
              {
                key: 'format',
                label: '格式与原始大小',
                children: `${value.source.format} · ${value.source.byteLength} 字节`,
              },
              { key: 'hash', label: '原始字节 SHA256', children: value.source.sha256 },
            ]}
          />
          {value.warnings.map((w, i) => (
            <Alert
              key={i}
              type={['text-only', 'body-only'].includes(w.code) ? 'info' : 'warning'}
              showIcon
              title={w.unit ? `第 ${w.unit} 单元 · ${w.message}` : w.message}
            />
          ))}
          <p>仅显示本次运行保存的来源与正文。后续文件变化不会改写这份记录。</p>
        </Card>
        <Card title="提取的正文">
          {value.units.length ? (
            <>
              <label>
                来源定位
                <Select
                  aria-label="资料来源定位"
                  value={unit?.index}
                  onChange={setIndex}
                  options={value.units.map((u) => ({ value: u.index, label: u.locator }))}
                />
              </label>
              <pre tabIndex={0} aria-label="定位正文">
                {unit?.text || '此单元没有文字，不能据此猜测内容。'}
              </pre>
            </>
          ) : (
            <p>没有正文单元。</p>
          )}
          <Collapse
            items={[
              {
                key: 'full',
                label: '查看完整提取文本',
                children: (
                  <pre tabIndex={0} aria-label="完整提取文本">
                    {value.text || '内容为空'}
                  </pre>
                ),
              },
            ]}
          />
          <p>
            文字不保留原排版，不识别图片；partial/empty应先处理缺口。后续会话只采用明确选择的范围。
          </p>
        </Card>
      </div>
    </section>
  );
}
export default function DocumentResults({
  snapshot,
  output,
}: {
  snapshot?: Flow;
  output: unknown;
}) {
  const [selected, setSelected] = useState('');
  const results: { id: string; value: DocumentResult }[] = [];
  let visits = 0;
  const walk = (nodes: Step[], values: any, path = '') => {
    if (!values || typeof values !== 'object') return;
    for (const n of nodes) {
      if (++visits > 10000 || results.length >= 1000) return;
      const value = values[n.id],
        id = path + n.id;
      if (n.type === 'document') {
        try {
          assertDocumentResult(value);
          results.push({ id, value });
        } catch {}
      }
      if (n.type === 'condition') walk([...n.then, ...n.else], value, id + '/');
      if (n.type === 'loop' && Array.isArray(value))
        for (let i = 0; i < value.length && visits <= 10000; i++)
          walk(n.body, value[i], id + `[${i}]/`);
    }
  };
  if (snapshot) walk(snapshot.steps, output);
  const current = results.find((r) => r.id === selected) ?? results[0];
  if (!current) return null;
  return (
    <section className="document-results" aria-label="本次资料解析">
      <h3>本次资料解析</h3>
      <Select
        aria-label="选择资料解析步骤"
        value={current.id}
        onChange={setSelected}
        options={results.map((r, index) => ({
          value: r.id,
          label: `${index + 1}. ${r.value.source.name}`,
        }))}
      />
      {(visits > 10000 || results.length >= 1000) && (
        <p>这里只列出有界数量的来源；其他结果可在完整结构化输出中核对。</p>
      )}
      <DocumentResultView key={current.id} value={current.value} />
    </section>
  );
}
