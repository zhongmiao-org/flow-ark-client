import { Alert, Button, Card, Radio } from 'antd';
import { useAppearance, type Appearance } from './appearance';
import './appearance.css';

export default function AppearancePage() {
  const { appearance, resolved, systemDark, error, change } = useAppearance();
  return (
    <Card className="appearance-card">
      <h2>配色方案</h2>
      <Radio.Group
        aria-label="配色方案"
        value={appearance}
        optionType="button"
        buttonStyle="solid"
        onChange={(event) => change(event.target.value as Appearance)}
        options={[
          { value: 'system', label: '跟随系统' },
          { value: 'light', label: '浅色' },
          { value: 'dark', label: '深色' },
        ]}
      />
      <p role="status">
        {appearance === 'system' ? '跟随系统' : appearance === 'light' ? '手动浅色' : '手动深色'}
        {' · '}系统{systemDark ? '深色' : '浅色'}
        {' · '}生效主题 {resolved === 'dark' ? 'Dark' : 'Light'}
      </p>
      <Alert
        type={error ? 'warning' : 'info'}
        showIcon
        title={error ? '外观尚未保存' : '即时生效并本地保存'}
        action={
          error ? <Button onClick={() => change(appearance)}>重试保存外观</Button> : undefined
        }
        description={
          error ||
          '跟随系统时响应系统变化；手动浅色或深色不随系统改变。切换保留草稿、光标、滚动和活动运行。'
        }
      />
    </Card>
  );
}
