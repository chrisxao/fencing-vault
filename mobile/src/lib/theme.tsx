import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useColorScheme } from 'react-native';

export type ThemeMode = 'light' | 'dark' | 'system';

export type Palette = {
  background: string;
  surface: string;
  elevated: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  danger: string;
  success: string;
};

const light: Palette = {
  background: '#f5f5f2',
  surface: '#ffffff',
  elevated: '#fafaf8',
  text: '#202124',
  muted: '#74767e',
  border: '#deded8',
  accent: '#273c59',
  accentText: '#ffffff',
  danger: '#a95850',
  success: '#567d63',
};

const dark: Palette = {
  background: '#101114',
  surface: '#191a1f',
  elevated: '#222329',
  text: '#f1f1ee',
  muted: '#999ba5',
  border: '#303239',
  accent: '#d6dde8',
  accentText: '#17191d',
  danger: '#dc8f86',
  success: '#88b696',
};

type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  colors: Palette;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'fencing-vault-theme';

export function ThemeProvider({ children }: PropsWithChildren) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setModeState(stored);
      }
    });
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  };
  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');

  const value = useMemo(
    () => ({ mode, setMode, isDark, colors: isDark ? dark : light }),
    [mode, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
