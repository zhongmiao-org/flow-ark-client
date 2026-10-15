import { ConfigProvider, theme, type GlobalToken, type ThemeConfig } from 'antd';
import type { editor } from 'monaco-editor';
import type { RunState } from '../shared/types';
import type { ToolConnection } from '../shared/tool-connections';
import type { McpArgumentReview } from '../shared/mcp-argument-review';
import type { McpReceipt } from '../shared/mcp-run';
import type { PlanningTask } from '../shared/planning';
import type { DesktopReceipt } from '../shared/desktop-run';
import type { DesktopPlanInspection } from '../shared/desktop-planning';
import zhCN from 'antd/locale/zh_CN';
import { useLayoutEffect, type ReactNode } from 'react';
import { useAppearance } from './appearance';
import { semanticColors } from './appearance-tokens';

export const runStateColors: Record<
  string,
  'default' | 'processing' | 'success' | 'warning' | 'error'
> = {
  QUEUED: 'processing',
  RUNNING: 'processing',
  PAUSED: 'warning',
  WAITING_INPUT: 'warning',
  CANCELLING: 'default',
  CANCELLED: 'default',
  INTERRUPTED: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'error',
} as const satisfies Record<RunState, string>;

export const runStepColors: Record<string, (typeof runStateColors)[string]> = {
  success: runStateColors.SUCCEEDED,
  running: runStateColors.RUNNING,
  warning: runStateColors.PAUSED,
  neutral: runStateColors.CANCELLED,
};

export const elementPickerColors: Record<string, (typeof runStateColors)[string]> = {
  info: 'processing',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

export const toolConnectionColors: Record<
  ToolConnection['status'],
  (typeof runStateColors)[string]
> = {
  verified: 'success',
  unverified: 'warning',
  disconnected: 'warning',
  failed: 'warning',
};

export const toolCapabilityColors: Record<
  'added' | 'changed' | 'removed' | 'unchanged',
  (typeof runStateColors)[string]
> = {
  added: 'success',
  changed: 'warning',
  removed: 'warning',
  unchanged: 'default',
};

export const mcpArgumentColors: Record<
  McpArgumentReview['status'],
  (typeof runStateColors)[string]
> = {
  valid: 'processing',
  invalid: 'warning',
  deferred: 'default',
  unsupported: 'warning',
  unavailable: 'default',
};
export const mcpReceiptColors: Record<
  McpReceipt['status'] | 'waiting',
  (typeof runStateColors)[string]
> = {
  received: 'success',
  'tool-error': 'error',
  'not-sent': 'default',
  unknown: 'error',
  waiting: 'processing',
};

export const planningTaskColors: Record<PlanningTask['status'], (typeof runStateColors)[string]> = {
  draft: 'default',
  generating: 'processing',
  plan: 'processing',
  clarify: 'warning',
  unsupported: 'warning',
  failed: 'error',
  cancelled: 'default',
};

export const desktopCapabilityColors: Record<
  DesktopPlanInspection['replacement'],
  (typeof runStateColors)[string]
> = {
  available: 'processing',
  unsupported: 'warning',
  unavailable: 'warning',
};
export const desktopReceiptColors: Record<
  DesktopReceipt['status'],
  (typeof runStateColors)[string]
> = {
  verified: 'success',
  'not-written': 'default',
  unknown: 'warning',
};

// Resolve Ant Design aliases and workspace CSS from the same Figma mode.
export function appearanceTheme(mode: 'light' | 'dark'): ThemeConfig {
  const c = semanticColors[mode];
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: c['--fa-action-primary'],
      colorPrimaryHover: c['--fa-action-hover'],
      colorPrimaryActive: c['--fa-action-active'],
      colorPrimaryBg: c['--fa-action-subtle'],
      colorLink: c['--fa-text-link'],
      colorLinkHover: c['--fa-text-link'],
      colorInfo: c['--fa-status-info'],
      colorInfoText: c['--fa-status-info'],
      colorInfoBg: c['--fa-status-info-bg'],
      colorSuccess: c['--fa-status-success-solid'],
      colorSuccessText: c['--fa-status-success'],
      colorSuccessBg: c['--fa-status-success-bg'],
      colorWarning: c['--fa-status-warning-solid'],
      colorWarningText: c['--fa-status-warning'],
      colorWarningBg: c['--fa-status-warning-bg'],
      colorError: c['--fa-action-danger'],
      colorErrorText: c['--fa-status-error'],
      colorErrorBg: c['--fa-status-error-bg'],
      colorText: c['--fa-text-primary'],
      colorTextSecondary: c['--fa-text-secondary'],
      colorTextPlaceholder: c['--fa-text-secondary'],
      colorTextDisabled: c['--fa-action-disabled'],
      colorTextLightSolid: c['--fa-text-inverse'],
      colorBgContainer: c['--fa-bg-surface'],
      colorBgElevated: c['--fa-bg-elevated'],
      colorBgLayout: c['--fa-bg-canvas'],
      colorBgContainerDisabled: c['--fa-bg-subtle'],
      colorFillQuaternary: c['--fa-bg-subtle'],
      colorBorder: c['--fa-border-control'],
      colorBorderSecondary: c['--fa-border-default'],
      colorBgSpotlight: c['--fa-bg-nav'],
      colorBgMask: c['--fa-bg-mask'],
      controlOutline: c['--fa-action-focus'],
      fontFamily: "'Noto Sans SC Variable', sans-serif",
      fontSize: 14,
      lineHeight: 22 / 14,
      controlHeight: 40,
      borderRadius: 8,
      borderRadiusLG: 16,
      controlOutlineWidth: 2,
    },
    components: {
      Alert: {
        colorSuccess: c['--fa-status-success'],
        colorWarning: c['--fa-status-warning'],
        colorError: c['--fa-status-error'],
        colorInfo: c['--fa-status-info'],
      },
      Badge: {
        colorSuccess: c['--fa-status-success'],
        colorWarning: c['--fa-status-warning'],
        colorError: c['--fa-status-error'],
      },
      Card: { borderRadiusLG: 12, boxShadowTertiary: 'none' },
      Menu: { darkItemColor: c['--fa-text-nav'] },
      Modal: { titleFontSize: 28, titleLineHeight: 40 / 28, borderRadiusLG: 16 },
      Tag: { borderRadiusSM: 999, lineHeightSM: 26 / 12 },
      Button: { fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none' },
    },
  };
}
export const flowArkTheme = appearanceTheme('light');

export function scriptEditorTheme(token: GlobalToken): editor.IStandaloneThemeData {
  return {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': token.colorBgSpotlight,
      'editor.foreground': token.colorTextLightSolid,
      'editorGutter.background': token.colorBgSpotlight,
      'editorLineNumber.foreground': semanticColors.light['--fa-text-nav'],
      'editorLineNumber.activeForeground': token.colorTextLightSolid,
      'editorCursor.foreground': token.colorTextLightSolid,
      'editor.lineHighlightBackground': token.colorBgSpotlight,
      'editor.lineHighlightBorder': token.colorBgSpotlight,
    },
  };
}

function WorkspaceTokens({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  const { resolved } = useAppearance();
  useLayoutEffect(() => {
    const values: Record<string, string> = {
      ...semanticColors[resolved],
      '--fa-shadow-floating': token.boxShadowSecondary,
      '--fa-font-body': token.fontFamily,
      '--fa-radius-8': `${token.borderRadius}px`,
    };
    const root = document.documentElement.style;
    const previous = Object.keys(values).map((key) => [key, root.getPropertyValue(key)]);
    const previousMode = document.documentElement.dataset.theme;
    const previousScheme = root.colorScheme;
    document.documentElement.dataset.theme = resolved;
    root.colorScheme = resolved;
    for (const [key, value] of Object.entries(values)) root.setProperty(key, value);
    return () => {
      for (const [key, value] of previous) {
        if (value) root.setProperty(key, value);
        else root.removeProperty(key);
      }
      if (previousMode) document.documentElement.dataset.theme = previousMode;
      else delete document.documentElement.dataset.theme;
      root.colorScheme = previousScheme;
    };
  }, [token, resolved]);
  return children;
}

export function ApplicationTheme({ children }: { children: ReactNode }) {
  const { resolved } = useAppearance();
  return (
    <ConfigProvider
      locale={zhCN}
      theme={appearanceTheme(resolved)}
      button={{ autoInsertSpace: false }}
      modal={{
        styles: {
          container: { padding: 28 },
          header: { marginBottom: 16 },
          footer: { marginTop: 16 },
        },
      }}
      getPopupContainer={(trigger) => trigger?.closest('.ant-drawer-body') ?? document.body}
    >
      <WorkspaceTokens>{children}</WorkspaceTokens>
    </ConfigProvider>
  );
}
