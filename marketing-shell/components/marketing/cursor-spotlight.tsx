import type { ReactNode } from 'react';

// The cursor-following glow was retired with the redesign; this keeps the
// wrapper's layout contract (a div around children) without the effect.
export function CursorSpotlight({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
  radius?: number;
  intensity?: number;
}) {
  return <div className={className}>{children}</div>;
}
