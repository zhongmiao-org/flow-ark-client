import { Tooltip } from 'antd';
import ActionButton from './ActionButton';
import { useContext } from 'react';
import { VariableNavigationContext } from './variable-navigation';
import './editor-workspace-toolbar.css';

export default function EditorWorkspaceToolbar({
  current,
  back,
  backLabel = '返回流程编排',
  showBrowser,
  disabled = false,
}: {
  current: string;
  back: () => void;
  backLabel?: string;
  showBrowser?: () => void;
  disabled?: boolean;
}) {
  const navigation = useContext(VariableNavigationContext);
  const openBrowser = showBrowser ?? navigation?.showBrowser;
  const savingHint = '正在保存，请等待当前操作完成';
  return (
    <div className="editor-workspace-toolbar">
      <ActionButton
        hint={disabled ? savingHint : backLabel}
        triggerClassName="editor-workspace-back"
        htmlType="button"
        disabled={disabled || undefined}
        onClick={back}
      >
        ← {backLabel}
      </ActionButton>
      <nav aria-label="当前位置">
        {navigation && (
          <>
            <ActionButton
              hint={disabled ? savingHint : '返回我的流程，保留原有离开核对'}
              type="link"
              htmlType="button"
              disabled={disabled || undefined}
              onClick={navigation.openLibrary}
            >
              我的流程
            </ActionButton>
            <span aria-hidden="true">/</span>
            <ActionButton
              hint={disabled ? savingHint : navigation.flowName}
              type="link"
              triggerClassName="editor-workspace-flow-trigger"
              htmlType="button"
              className="editor-workspace-flow"
              disabled={disabled || undefined}
              title={navigation.flowName}
              onClick={navigation.openFlow}
            >
              {navigation.flowName}
            </ActionButton>
            <span aria-hidden="true">/</span>
          </>
        )}
        <Tooltip title={current} trigger={['hover', 'focus']}>
          <span aria-current="page" tabIndex={0}>
            {current}
          </span>
        </Tooltip>
      </nav>
      {openBrowser && (
        <ActionButton
          hint={disabled ? savingHint : '在主窗口右侧显示网页面板'}
          triggerClassName="editor-workspace-browser"
          htmlType="button"
          disabled={disabled || undefined}
          onClick={openBrowser}
        >
          显示网页
        </ActionButton>
      )}
    </div>
  );
}
