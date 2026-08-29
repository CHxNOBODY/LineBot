/** Soft pastel palette — everything visual pulls its colours from here. */
export const palette = {
  bg: '#FFFBFD',
  card: '#FFFFFF',
  pink: '#FF8FB1',
  pinkSoft: '#FFE4EC',
  mint: '#5FC9B7',
  mintSoft: '#DFF6F1',
  lavender: '#B79CED',
  lavenderSoft: '#EFE8FF',
  sun: '#FFC65C',
  sunSoft: '#FFF2D6',
  text: '#4A4453',
  muted: '#9B93A6',
  hairline: '#F1EAF0',
  paid: '#4FBF95',
} as const;

/** Cycled so each row in a list gets its own colour dot. */
export const dotColors = [palette.pink, palette.mint, palette.lavender, palette.sun] as const;

export function dotColor(index: number): string {
  return dotColors[index % dotColors.length]!;
}

/** Little faces to keep the cards friendly. */
export const face = {
  bill: '🧾',
  money: '💸',
  done: '✅',
  waiting: '🕐',
  pending: '⏳',
  party: '🎉',
  wave: '👋',
  cat: '🐱',
  sparkle: '✨',
  heart: '💗',
} as const;

export function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    timeZone,
  }).format(date);
}
