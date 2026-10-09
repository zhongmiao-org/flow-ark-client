import { ConfigProvider, theme, type ThemeConfig } from 'antd';
import type { RunState } from '../shared/types';
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
    Menu: { darkItemColor: '#A8B4CA' },
    Modal: { titleFontSize: 28, titleLineHeight: 40 / 28, borderRadiusLG: 12 },
    Tag: { borderRadiusSM: 999, lineHeightSM: 26 / 12 },
    Button: { fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none' },
  },
} satisfies ThemeConfig;

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
