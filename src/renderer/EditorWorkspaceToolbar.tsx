import { Button } from 'antd';
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
  return (
    <div className="editor-workspace-toolbar">
      <Button htmlType="button" disabled={disabled || undefined} onClick={back}>
        ← {backLabel}
      </Button>
      <nav aria-label="当前位置">
        {navigation && (
          <>
            <Button
              htmlType="button"
              disabled={disabled || undefined}
              onClick={navigation.openLibrary}
            >
              我的流程
            </Button>
            <span aria-hidden="true">/</span>
            <Button
              htmlType="button"
              className="editor-workspace-flow"
              disabled={disabled || undefined}
              title={navigation.flowName}
              onClick={navigation.openFlow}
            >
              {navigation.flowName}
            </Button>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span aria-current="page" title={current}>
          {current}
        </span>
      </nav>
      {openBrowser && (
        <Button
          htmlType="button"
          className="editor-workspace-browser"
          disabled={disabled || undefined}
          onClick={openBrowser}
        >
          显示网页
        </Button>
      )}
    </div>
  );
}
