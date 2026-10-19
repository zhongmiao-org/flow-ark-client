import { useId, useState } from 'react';
import { Alert, Button, Card, Collapse, Input } from 'antd';
import type { BrowserCollectedResult } from '../shared/browser-fields';
import { activateCollapseWithSpace } from './collapseKeyboard';
import './browser-fields.css';
const statuses = {
  ok: '成功',
  missing: '未找到',
  ambiguous: '不唯一',
  'missing-attribute': '属性不存在',
  empty: '空文字或空白',
  hidden: '隐藏',
  clipped: '裁切',
  unsupported: '无法判定',
};
const reasons = {
  'hidden-target': '元素或祖先隐藏',
  'hidden-descendant': '后代含隐藏区域',
  'line-clamp': '正文行数被限制',
  'overflow-clip': '存在溢出裁切',
  'unsupported-layout': '布局无法可靠判定',
  'embedded-content': '包含非纯文字或嵌入内容',
  'generated-content': '包含生成内容',
};
export default function BrowserFieldsResultView({ value }: { value: BrowserCollectedResult }) {
  const [index, setIndex] = useState(0),
    id = useId();
  const f = value.fields[Math.min(index, value.fields.length - 1)];
  return (
    <section
      className="browser-fields-configuration browser-fields-result"
      aria-label="完整关联字段采集结果"
    >
      <h2>{value.version >= 2 ? '关联字段与正文采集结果' : '关联字段采集结果'}</h2>
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
            title={
              value.complete
                ? value.version === 3
                  ? '候选通过有限检查'
                  : '采集完整'
                : '采集不完整'
            }
            description={
              value.complete
                ? `${value.fields.length}项已核对；必填字段均唯一且非空。`
                : '字段缺失、为空、不唯一，或正文隐藏、裁切及无法判定，请查看原因并由本人核对。'
            }
          />
          <p>
            可选字段缺失或为空不阻止完整；隐藏、裁切或无法判定的可选正文仍使结果不完整。源内容仍不可信，完整性不代表账号验证或动作授权。
          </p>
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
              <dd>
                {f.operation === 'text'
                  ? 'DOM文字（textContent）'
                  : f.operation === 'rendered-text'
                    ? '已排版正文（待核对）'
                    : '原始属性'}
              </dd>
              <dt>属性名</dt>
              <dd>{f.attribute ?? '不适用'}</dd>
              <dt>必填</dt>
              <dd>{f.required ? '是' : '否'}</dd>
            </dl>
            {'issues' in f && f.issues.length > 0 && (
              <Alert
                type="warning"
                title="正文未采用"
                description={f.issues.map((issue) => reasons[issue]).join('；')}
              />
            )}
            {f.operation === 'rendered-text' && 'ignoredAncestorSpaces' in f && (
              <p>
                本次核准无绘制祖先空格 {f.ignoredAncestorSpaces} 处；正文候选仍须本人完整阅读核对。
              </p>
            )}
            <strong>
              {f.operation === 'rendered-text' ? '已排版正文候选 · 仍需本人核对' : '原始值'}
            </strong>
            <div className="browser-fields-value">
              {f.value === null ? (
                <code>null</code>
              ) : f.value.trim() === '' ? (
                <code>{JSON.stringify(f.value)}</code>
              ) : (
                f.value
              )}
            </div>
            <p>
              隐藏、裁切、无法判定的正文为 null，不返回剩余片段；0 项、属性不存在和不唯一保留
              null；空属性保留空文字，不把相对链接改成绝对地址。
            </p>
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
