// Tiny class-name helper. Identical to the marketing-shell version so the
// two surfaces can share copy-pasted patterns without import gymnastics.

export function cn(...inputs: Array<string | undefined | null | false>): string {
  return inputs.filter(Boolean).join(' ');
}
