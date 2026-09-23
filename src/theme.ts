/**
 * Colour in this app means temperature: amber for hot and current, cool
 * grey-blue for cold and past. Nothing is tinted for decoration.
 *
 * The two status colours below are the deliberate exception, added at Dr.
 * Namal's request — green and red for whether a process is running, which is a
 * convention people read instantly without being taught it.
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
  /** Running. */
  ok: '#4ECB71',
  /** Not running. */
  stop: '#E5544F',
} as const;

export const RADIUS = { card: 18, chip: 12, small: 9 };

/** Accent for the current freshness state. */
export const accentFor = (live: boolean) => (live ? C.hot : C.coolSoft);
