import { useEffect, useRef, useState } from 'react';
import {
  desktopWindowDiscovery,
  desktopSelectionPreview,
  selectionReasons,
  type DesktopWindowDiscovery,
  type DesktopSelectionPreview,
} from '../shared/desktop-windows';

const release = (observationId?: string) => {
  if (observationId)
    void window.flowark.request('desktop.windows.release', { observationId }).catch(() => {});
};
export default function useDesktopWindows(active: boolean, identity: string) {
  const [snapshot, setSnapshot] = useState<DesktopWindowDiscovery>();
  const [selectedId, setSelectedId] = useState<string>();
  const [preview, setPreviewState] = useState<DesktopSelectionPreview>();
  const previewRef = useRef<DesktopSelectionPreview | undefined>(undefined);
  const setPreview = (next: DesktopSelectionPreview | undefined) => {
    previewRef.current = next;
    setPreviewState(next);
  };
  const discard = (value?: DesktopSelectionPreview) => {
    if (value?.status === 'ready')
      void window.flowark
        .request('desktop.selection.clear', {
          observationId: value.observationId,
          windowId: value.windowId,
          previewId: value.previewId,
        })
        .catch(() => {});
  };
  const [reading, setReading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [settingsPending, setSettingsPending] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const epoch = useRef(0),
    previewEpoch = useRef(0),
    observation = useRef<string | undefined>(undefined);
  const clearPreview = () => {
    discard(previewRef.current);
    previewEpoch.current++;
    setPreview(undefined);
    setReading(false);
  };
  const releaseCurrent = () => {
    release(observation.current);
    observation.current = undefined;
  };
  const refresh = async () => {
    const ticket = ++epoch.current,
      requestId = crypto.randomUUID();
    releaseCurrent();
    clearPreview();
    setSnapshot(undefined);
    setSelectedId(undefined);
    setExpired(false);
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const next = desktopWindowDiscovery.parse(
        await window.flowark.request('desktop.windows.list', { requestId }),
      );
      if (next.requestId !== requestId) throw new Error('观察来源不一致');
      if (epoch.current !== ticket) {
        release(next.observationId);
        return;
      }
      observation.current = next.observationId;
      setSnapshot(next);
    } catch {
      if (epoch.current === ticket) setError('无法读取应用窗口，请重新检查。');
    } finally {
      if (epoch.current === ticket) setLoading(false);
    }
  };
  useEffect(() => {
    setSnapshot(undefined);
    setSelectedId(undefined);
    setExpired(false);
    setError('');
    setNotice('');
    setSettingsPending(false);
    setLoading(false);
    clearPreview();
    if (active) void refresh();
    return () => {
      epoch.current++;
      previewEpoch.current++;
      discard(previewRef.current);
      releaseCurrent();
    };
  }, [active, identity]);
  useEffect(() => {
    if (!snapshot?.expiresAt) return;
    const timer = setTimeout(
      () => {
        if (observation.current !== snapshot.observationId) return;
        clearPreview();
        releaseCurrent();
        setExpired(true);
        setNotice(selectionReasons.expired);
      },
      Math.max(0, snapshot.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [snapshot?.observationId, snapshot?.expiresAt]);
  const select = (id?: string) => {
    clearPreview();
    setSelectedId(id);
    setError('');
  };
  const selected = snapshot?.windows.find((window) => window.id === selectedId);
  const readSelection = async () => {
    if (!snapshot?.observationId || !selected || reading || loading || expired) return;
    const source = { observationId: snapshot.observationId, windowId: selected.id };
    discard(previewRef.current);
    const ticket = ++previewEpoch.current;
    setPreview(undefined);
    setReading(true);
    setError('');
    setNotice('');
    try {
      const next = desktopSelectionPreview.parse(
        await window.flowark.request('desktop.selection.preview', source),
      );
      if (next.observationId !== source.observationId || next.windowId !== source.windowId)
        throw new Error('预览来源不一致');
      if (ticket !== previewEpoch.current) {
        discard(next);
        return;
      }
      if (
        next.status === 'ready' &&
        (next.expiresAt <= Date.now() || next.expiresAt !== snapshot.expiresAt)
      ) {
        setExpired(true);
        releaseCurrent();
        setNotice(selectionReasons.expired);
        return;
      }
      setPreview(next);
      if (
        ['expired', 'window-changed', 'permission-required', 'unavailable'].includes(next.status)
      ) {
        setExpired(true);
        releaseCurrent();
      }
    } catch {
      if (ticket === previewEpoch.current) {
        setPreview({
          version: 1,
          ...source,
          status: 'unavailable',
          reason: selectionReasons.unavailable,
        });
        setExpired(true);
        releaseCurrent();
      }
    } finally {
      if (ticket === previewEpoch.current) setReading(false);
    }
  };
  const openSettings = async () => {
    const ticket = epoch.current;
    setSettingsPending(true);
    setError('');
    try {
      await window.flowark.request('desktop.accessibility.openSettings');
      if (epoch.current === ticket) setNotice('已请求打开系统设置。完成调整后，请返回并重新检查。');
    } catch {
      if (epoch.current === ticket)
        setError('系统设置未能打开，请手动进入系统设置 → 隐私与安全性 → 辅助功能。');
    } finally {
      if (epoch.current === ticket) setSettingsPending(false);
    }
  };
  return {
    snapshot,
    loading,
    settingsPending,
    error,
    notice,
    selected,
    select,
    refresh,
    openSettings,
    preview,
    reading,
    expired,
    readSelection,
    clearPreview,
  };
}
