'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView, useMotionValue, useSpring } from 'motion/react';
import { cn } from '@/lib/utils';

// Count-up on scroll-into-view. Springs from 0 to value with critical damping
// for a settled, premium feel — no overshoot.
export function NumberTicker({
  value,
  className,
  decimalPlaces = 0,
  delay = 0,
  prefix = '',
  suffix = '',
}: {
  value: number;
  className?: string;
  decimalPlaces?: number;
  delay?: number;
  prefix?: string;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px' });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { damping: 42, stiffness: 80 });
  const [display, setDisplay] = useState('0');

  useEffect(() => {
    if (!inView) return;
    const t = setTimeout(() => motionValue.set(value), delay * 1000);
    return () => clearTimeout(t);
  }, [motionValue, inView, value, delay]);

  useEffect(() => {
    return spring.on('change', (latest) => {
      setDisplay(
        Intl.NumberFormat('en-GB', {
          minimumFractionDigits: decimalPlaces,
          maximumFractionDigits: decimalPlaces,
        }).format(Number(latest.toFixed(decimalPlaces))),
      );
    });
  }, [spring, decimalPlaces]);

  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}
