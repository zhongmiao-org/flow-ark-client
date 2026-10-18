import { useId, useState } from 'react';
import { Alert, Button, Card, Collapse, Input } from 'antd';
import type { BrowserFieldsResult } from '../shared/contracts.generated';
import { activateCollapseWithSpace } from './collapseKeyboard';
import './browser-fields.css';
const statuses = {
  ok: '成功',
  missing: '未找到',
  ambiguous: '不唯一',
  'missing-attribute': '属性不存在',
  empty: '空文字或空白',
};
export default function BrowserFieldsResultView({ value }: { value: BrowserFieldsResult }) {
  const [index, setIndex] = useState(0),
    id = useId();
  const f = value.fields[Math.min(index, value.fields.length - 1)];
  return (
    <section
      className="browser-fields-configuration browser-fields-result"
      aria-label="完整关联字段采集结果"
    >
      <h2>关联字段采集结果</h2>
      <div className="browser-fields-top">
        <Card>
          <h2>采集来源</h2>
          <dl>
            <dt>顶层网址</dt>
            <dd>{value.url}</dd>
            <dt>框架文档</dt>
            <dd>{value.documentUrl}</dd>
            <dt>唯一根元素</dt>
            <dd>{value.selector}</dd>
            <dt>框架路径</dt>
            <dd>{value.framePath.length ? value.framePath.join(' → ') : '顶层文档'}</dd>
          </dl>
        </Card>
        <Card>
          <h2>完整性</h2>
          <Alert
            type={value.complete ? 'success' : 'warning'}
            title={value.complete ? '采集完整' : '采集不完整'}
            description={
              value.complete
                ? `${value.fields.length}项已核对；必填字段均唯一且非空。`
                : '必填字段缺失/为空，或有字段不唯一，请按流程分支或本人核对。'
            }
          />
          <p>可选字段缺失或为空不阻止完整。源内容仍不可信，完整性不代表账号验证或动作授权。</p>
        </Card>
      </div>
      <Card>
        <h2>字段结果 · 保留原始值</h2>
        <div className="browser-fields-grid">
          <nav aria-label="采集字段结果列表">
            {value.fields.map((item, i) => (
              <Button
                key={item.key}
                type={i === index ? 'primary' : 'text'}
                aria-current={i === index ? 'true' : undefined}
                onClick={() => setIndex(i)}
              >
                <strong>{item.key}</strong>
                <small>
                  {item.count} 项 · {statuses[item.status]} · {item.required ? '必填' : '可选'}
                </small>
              </Button>
            ))}
          </nav>
          <section className="browser-fields-current" aria-label="当前采集字段详情">
            <h3>
              {f.key} · {statuses[f.status]} · 匹配 {f.count} 项
            </h3>
            <label htmlFor={id + 'selector'}>相对根元素的 CSS 定位</label>
            <Input readOnly id={id + 'selector'} value={f.selector} />
            <dl>
              <dt>读取方式</dt>
              <dd>{f.operation === 'text' ? '文字（textContent）' : '原始属性'}</dd>
              <dt>属性名</dt>
              <dd>{f.attribute ?? '不适用'}</dd>
              <dt>必填</dt>
              <dd>{f.required ? '是' : '否'}</dd>
            </dl>
            <strong>原始值</strong>
            <div className="browser-fields-value">
              {f.value === null ? (
                <code>null</code>
              ) : f.value.trim() === '' ? (
                <code>{JSON.stringify(f.value)}</code>
              ) : (
                f.value
              )}
            </div>
            <p>0 项、属性不存在和不唯一保留 null；空属性保留空文字，不把相对链接改成绝对地址。</p>
          </section>
        </div>
      </Card>
      <Collapse
        items={[
          {
            key: 'raw',
            label: '原始详情 · 高级核对',
            onKeyDown: activateCollapseWithSpace,
            children: <pre>{JSON.stringify(value, null, 2)}</pre>,
          },
        ]}
      />
    </section>
  );
}
