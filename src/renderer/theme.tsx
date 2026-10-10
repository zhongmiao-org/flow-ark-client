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

// Figma semantic tokens. All shared controls and workspace colours derive from this theme.
export const flowArkTheme = {
  token: {
    colorPrimary: '#315EF5',
    colorPrimaryHover: '#244BDC',
    colorPrimaryBg: '#EDF2FF',
    colorInfo: '#315EF5',
    colorSuccess: '#147D61',
    colorSuccessBg: '#E8F6EF',
    colorWarning: '#946200',
    colorWarningBg: '#FFF5DB',
    colorError: '#B83B48',
    colorErrorBg: '#FDEDF0',
    colorText: '#172033',
    colorTextSecondary: '#637089',
    colorTextPlaceholder: '#637089',
    colorTextDisabled: '#B9C3D3',
    colorTextLightSolid: '#FFFFFF',
    colorBgContainer: '#FFFFFF',
    colorBgLayout: '#F6F7FB',
    colorFillQuaternary: '#EFF2F7',
    colorBorder: '#DFE4ED',
    colorBorderSecondary: '#DFE4ED',
    colorBgSpotlight: '#121A2A',
    colorBgMask: 'rgba(18, 26, 42, 0.42)',
    fontFamily: "'Noto Sans SC Variable', sans-serif",
    fontSize: 14,
    lineHeight: 22 / 14,
    controlHeight: 40,
    borderRadius: 8,
    borderRadiusLG: 16,
    controlOutlineWidth: 2,
  },
  components: {
    Card: { borderRadiusLG: 12, boxShadowTertiary: 'none' },
    Menu: { darkItemColor: '#A8B4CA' },
    Modal: { titleFontSize: 28, titleLineHeight: 40 / 28, borderRadiusLG: 12 },
    Tag: { borderRadiusSM: 999, lineHeightSM: 26 / 12 },
    Button: { fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none' },
  },
} satisfies ThemeConfig;

export function scriptEditorTheme(token: GlobalToken): editor.IStandaloneThemeData {
  return {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': token.colorBgSpotlight,
      'editor.foreground': token.colorTextLightSolid,
      'editorGutter.background': token.colorBgSpotlight,
      'editorLineNumber.foreground': flowArkTheme.components.Menu.darkItemColor,
      'editorLineNumber.activeForeground': token.colorTextLightSolid,
      'editorCursor.foreground': token.colorTextLightSolid,
      'editor.lineHighlightBackground': token.colorBgSpotlight,
      'editor.lineHighlightBorder': token.colorBgSpotlight,
    },
  };
}

function WorkspaceTokens({ children }: { children: ReactNode }) {
  const { token } = theme.useToken();
  useLayoutEffect(() => {
    const values: Record<string, string> = {
      white: token.colorBgContainer,
      fog: token.colorBgLayout,
      soft: token.colorFillQuaternary,
      line: token.colorBorder,
      ink: token.colorText,
      muted: token.colorTextSecondary,
      nav: token.colorBgSpotlight,
      navMuted: flowArkTheme.components.Menu.darkItemColor,
      blue: token.colorPrimary,
      blueHover: token.colorPrimaryHover,
      blueSoft: token.colorPrimaryBg,
      green: token.colorSuccess,
      greenSoft: token.colorSuccessBg,
      amber: token.colorWarning,
      amberSoft: token.colorWarningBg,
      red: token.colorError,
      redSoft: token.colorErrorBg,
      disabled: token.colorTextDisabled,
      mask: token.colorBgMask,
      floatingShadow: token.boxShadowSecondary,
    };
    const root = document.documentElement.style;
    const previous = Object.keys(values).map((key) => [
      key,
      root.getPropertyValue(`--fa-raw-${key}`),
    ]);
    for (const [key, value] of Object.entries(values)) root.setProperty(`--fa-raw-${key}`, value);
    root.setProperty('--fa-font-body', token.fontFamily);
    root.setProperty('--fa-radius-8', `${token.borderRadius}px`);
    return () => {
      for (const [key, value] of previous) {
        if (value) root.setProperty(`--fa-raw-${key}`, value);
        else root.removeProperty(`--fa-raw-${key}`);
      }
      root.removeProperty('--fa-font-body');
      root.removeProperty('--fa-radius-8');
    };
  }, [token]);
  return children;
}

export function ApplicationTheme({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={flowArkTheme}
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
