'use client';

import { motion } from 'motion/react';
import { useEffect, useId, useState, type RefObject } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedBeamProps {
  className?: string;
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  pathColor?: string;
  pathOpacity?: number;
  pathWidth?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
}

// SVG beam between two DOM refs. The static path is a thin ivory line at
// low opacity; the animated layer is a sweeping gradient. Drop multiple
// instances inside one container to fan multiple beams to one endpoint.
export function AnimatedBeam({
  className,
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = 5,
  delay = 0,
  pathColor = 'rgba(255,255,255,0.10)',
  pathOpacity = 1,
  pathWidth = 1.5,
  gradientStartColor = 'rgba(250,250,247,0)',
  gradientStopColor = 'rgba(250,250,247,0.95)',
}: AnimatedBeamProps) {
  const id = useId();
  const [pathD, setPathD] = useState('');
  const [dims, setDims] = useState({ width: 0, height: 0 });

  const gradientCoords = reverse
    ? { x1: ['90%', '-10%'], x2: ['100%', '0%'] }
    : { x1: ['10%', '110%'], x2: ['0%', '100%'] };

  useEffect(() => {
    const updatePath = () => {
      if (!containerRef.current || !fromRef.current || !toRef.current) return;
      const c = containerRef.current.getBoundingClientRect();
      const a = fromRef.current.getBoundingClientRect();
      const b = toRef.current.getBoundingClientRect();
      setDims({ width: c.width, height: c.height });
      const ax = a.left - c.left + a.width / 2;
      const ay = a.top - c.top + a.height / 2;
      const bx = b.left - c.left + b.width / 2;
      const by = b.top - c.top + b.height / 2;
      const ctrlY = ay - curvature;
      setPathD(`M ${ax},${ay} Q ${(ax + bx) / 2},${ctrlY} ${bx},${by}`);
    };

    const ro = new ResizeObserver(updatePath);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', updatePath);
    updatePath();

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updatePath);
    };
  }, [containerRef, fromRef, toRef, curvature]);

  return (
    <svg
      fill="none"
      width={dims.width}
      height={dims.height}
      viewBox={`0 0 ${dims.width} ${dims.height}`}
      xmlns="http://www.w3.org/2000/svg"
      className={cn('pointer-events-none absolute inset-0', className)}
    >
      <path d={pathD} stroke={pathColor} strokeWidth={pathWidth} strokeOpacity={pathOpacity} strokeLinecap="round" />
      <path d={pathD} strokeWidth={pathWidth} stroke={`url(#${id})`} strokeOpacity="1" strokeLinecap="round" />
      <defs>
        <motion.linearGradient
          id={id}
          gradientUnits="userSpaceOnUse"
          initial={{ x1: '0%', x2: '0%', y1: '0%', y2: '0%' }}
          animate={{
            x1: gradientCoords.x1,
            x2: gradientCoords.x2,
            y1: ['0%', '0%'],
            y2: ['0%', '0%'],
          }}
          transition={{
            delay,
            duration,
            ease: [0.16, 1, 0.3, 1],
            repeat: Infinity,
            repeatDelay: 0,
          }}
        >
          <stop stopColor={gradientStartColor} stopOpacity="0" />
          <stop stopColor={gradientStopColor} />
          <stop offset="32.5%" stopColor={gradientStopColor} />
          <stop offset="100%" stopColor={gradientStopColor} stopOpacity="0" />
        </motion.linearGradient>
      </defs>
    </svg>
  );
}
