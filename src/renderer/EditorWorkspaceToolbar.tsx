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
      <button type="button" disabled={disabled} onClick={back}>
        ← {backLabel}
      </button>
      <nav aria-label="当前位置">
        {navigation && (
          <>
            <button type="button" disabled={disabled} onClick={navigation.openLibrary}>
              我的流程
            </button>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              className="editor-workspace-flow"
              disabled={disabled}
              title={navigation.flowName}
              onClick={navigation.openFlow}
            >
              {navigation.flowName}
            </button>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span aria-current="page" title={current}>
          {current}
        </span>
      </nav>
      {openBrowser && (
        <button
          type="button"
          className="editor-workspace-browser"
          disabled={disabled}
          onClick={openBrowser}
        >
          显示网页
        </button>
      )}
    </div>
  );
}
