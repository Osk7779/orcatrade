// Section divider. The editorial "§ I label" rule was retired with the
// Apple-style redesign — sections now separate by whitespace and surface
// alternation alone. Kept as a no-op so page compositions stay stable.
export function ChapterRule(_props: { numeral: string; label: string }) {
  return null;
}
