// Tiny ANSI color helpers — keeps the CLI dependency-free. Honors NO_COLOR
// and respects whether stdout is a TTY.

const noColor = process.env.NO_COLOR === "1" || !process.stdout.isTTY;

const wrap = (open: string, close: string) => (s: string) =>
  noColor ? s : `\x1b[${open}m${s}\x1b[${close}m`;

export const c = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  blue: wrap("34", "39"),
  magenta: wrap("35", "39"),
  cyan: wrap("36", "39"),
  gray: wrap("90", "39"),
};
