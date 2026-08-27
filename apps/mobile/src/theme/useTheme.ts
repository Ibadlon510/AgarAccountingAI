import { useColorScheme } from 'react-native';
import { palettes, type ThemeColors } from './tokens';

export function useTheme(): { colors: ThemeColors; scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: palettes[scheme], scheme };
}
