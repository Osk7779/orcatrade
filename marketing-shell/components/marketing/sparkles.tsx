'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  delay: number;
}

// Small twinkling SVG dots around inline text. Used very sparingly — a
// single keyword in the hero. Ivory only.
export function SparklesText({
  children,
  className,
  count = 8,
}: {
  children: React.ReactNode;
  className?: string;
  count?: number;
}) {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  useEffect(() => {
    const generate = () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 120 - 10,
        size: 1.8 + Math.random() * 2.6,
        delay: Math.random() * 2,
      }));
    setSparkles(generate());
    const interval = setInterval(() => setSparkles(generate()), 3800);
    return () => clearInterval(interval);
  }, [count]);

  return (
    <span className={cn('relative inline-block', className)}>
      {sparkles.map((s) => (
        <svg
          key={s.id}
          aria-hidden
          className="pointer-events-none absolute text-[var(--color-ivory)]"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            animation: `sparkle-twinkle 2.6s ease-in-out ${s.delay}s infinite`,
          }}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" />
        </svg>
      ))}
      <span className="relative">{children}</span>
    </span>
  );
}
