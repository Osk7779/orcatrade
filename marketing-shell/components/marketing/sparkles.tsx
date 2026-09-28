// Sparkle twinkle retired; the accent word renders in the accent colour.
export function SparklesText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
  count?: number;
}) {
  return <span className={`text-[var(--color-accent)] ${className ?? ''}`}>{children}</span>;
}
