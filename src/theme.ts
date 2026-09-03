/**
 * All colour in this app means temperature. Live readings are amber (hot,
 * happening now); historical readings are cool grey. Nothing is tinted for
 * decoration, so a supervisor can tell live from stale before reading a word.
 */
export const C = {
  shell: '#0C120F',
  panel: '#151E19',
  panel2: '#1B2620',
  line: '#26332C',
  ink: '#E4EDE6',
  ink2: '#8FA298',
  ink3: '#5E7168',
  hot: '#F5A63C',
  warm: '#E0663C',
  cool: '#4C5FD0',
  coolSoft: '#6E8AA8',
  peak: '#FFDFA3',
} as const;

export const RADIUS = { card: 18, chip: 12, small: 9 };

/** Accent for the current freshness state. */
export const accentFor = (live: boolean) => (live ? C.hot : C.coolSoft);
