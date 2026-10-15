import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Appearance = 'system' | 'light' | 'dark';
const key = 'flowark.appearance.v1';
const valid = (value: unknown): value is Appearance =>
  value === 'system' || value === 'light' || value === 'dark';
const read = (): Appearance => {
  try {
    const value = localStorage.getItem(key);
    return valid(value) ? value : 'system';
  } catch {
    return 'system';
  }
};
const AppearanceContext = createContext<{
  appearance: Appearance;
  resolved: 'light' | 'dark';
  systemDark: boolean;
  error: string;
  change: (value: Appearance) => void;
}>({ appearance: 'system', resolved: 'light', systemDark: false, error: '', change: () => {} });

export const useAppearance = () => useContext(AppearanceContext);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState(read);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener('change', update);
    const storage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === key || event.key === null)) {
        setAppearance(read());
        setError('');
      }
    };
    window.addEventListener('storage', storage);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('storage', storage);
    };
  }, []);
  const resolved = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
  const change = (next: Appearance) => {
    setAppearance(next);
    try {
      localStorage.setItem(key, next);
      setError('');
    } catch {
      setError('外观已在当前窗口生效，但本地保存失败；重开后可能恢复原选择。可重新选择以重试。');
    }
  };
  return (
    <AppearanceContext.Provider value={{ appearance, resolved, systemDark, error, change }}>
      {children}
    </AppearanceContext.Provider>
  );
}
