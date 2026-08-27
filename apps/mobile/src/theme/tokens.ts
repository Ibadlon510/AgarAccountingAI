// Mirrors the palette defined in artifacts/agaraccounting/src/index.css so
// the mobile app and the web app read as the same product. HIG structure
// (tab bars, sheets, gesture-first interaction) is what's "Apple" about this
// app — the brand identity (warm parchment, forest green, gold) stays as-is.
const hsl = (h: number, s: number, l: number) => `hsl(${h}, ${s}%, ${l}%)`;

const light = {
  background: hsl(45, 25, 95),
  foreground: hsl(210, 15, 15),
  border: hsl(45, 15, 85),
  card: hsl(45, 30, 97),
  cardForeground: hsl(210, 15, 15),
  primary: hsl(150, 40, 25),
  primaryForeground: hsl(45, 25, 95),
  secondary: hsl(45, 20, 88),
  secondaryForeground: hsl(210, 15, 15),
  muted: hsl(45, 15, 90),
  mutedForeground: hsl(210, 10, 45),
  accent: hsl(40, 60, 50),
  accentForeground: hsl(210, 15, 15),
  destructive: hsl(0, 60, 50),
  destructiveForeground: hsl(45, 25, 95),
};

const dark = {
  background: hsl(210, 15, 12),
  foreground: hsl(45, 20, 90),
  border: hsl(210, 15, 20),
  card: hsl(210, 15, 15),
  cardForeground: hsl(45, 20, 90),
  primary: hsl(150, 40, 35),
  primaryForeground: hsl(45, 25, 95),
  secondary: hsl(210, 15, 20),
  secondaryForeground: hsl(45, 20, 90),
  muted: hsl(210, 15, 18),
  mutedForeground: hsl(45, 10, 65),
  accent: hsl(40, 60, 50),
  accentForeground: hsl(210, 15, 10),
  destructive: hsl(0, 60, 55),
  destructiveForeground: hsl(210, 15, 10),
};

export type ThemeColors = typeof light;

export const palettes = { light, dark };

export const fonts = {
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemibold: 'DMSans_600SemiBold',
  sansBold: 'DMSans_700Bold',
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_500Medium_Italic',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 10,
  lg: 14,
};
