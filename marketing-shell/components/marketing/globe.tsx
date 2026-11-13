'use client';

import { useEffect, useRef } from 'react';
import createGlobe, { type COBEOptions } from 'cobe';
import { cn } from '@/lib/utils';

// Light globe for the light surface: pale sphere, soft grey land dots and
// the accent blue on the Asia and Europe hubs.
const GLOBE_CONFIG: COBEOptions = {
  width: 800,
  height: 800,
  onRender: () => {},
  devicePixelRatio: 2,
  phi: 0,
  theta: 0.24,
  dark: 0,
  diffuse: 0.4,
  mapSamples: 24000,
  mapBrightness: 1.2,
  baseColor: [1, 1, 1],
  markerColor: [0, 0.443, 0.89],
  glowColor: [0.94, 0.94, 0.96],
  markers: [
    { location: [31.2304, 121.4737], size: 0.05 }, // Shanghai
    { location: [22.3193, 114.1694], size: 0.04 }, // Hong Kong
    { location: [10.8231, 106.6297], size: 0.035 }, // Ho Chi Minh
    { location: [28.6139, 77.209], size: 0.035 }, // Delhi
    { location: [23.8103, 90.4125], size: 0.035 }, // Dhaka
    { location: [41.0082, 28.9784], size: 0.035 }, // Istanbul
    { location: [52.52, 13.405], size: 0.045 }, // Berlin
    { location: [48.8566, 2.3522], size: 0.045 }, // Paris
    { location: [52.3676, 4.9041], size: 0.045 }, // Amsterdam
    { location: [40.4168, -3.7038], size: 0.035 }, // Madrid
    { location: [52.2297, 21.0122], size: 0.05 }, // Warsaw
    { location: [41.9028, 12.4964], size: 0.035 }, // Rome
  ],
};

export function Globe({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Start with the Europe–Asia hemisphere facing the viewer.
  const phiRef = useRef(3.4);
  const pointerInteractingRef = useRef<number | null>(null);
  const pointerMovementRef = useRef(0);

  useEffect(() => {
    if (!canvasRef.current) return;

    let width = 0;
    const onResize = () => {
      if (canvasRef.current) width = canvasRef.current.offsetWidth;
    };
    window.addEventListener('resize', onResize);
    onResize();

    const globe = createGlobe(canvasRef.current, {
      ...GLOBE_CONFIG,
      width: width * 2,
      height: width * 2,
      onRender: (state) => {
        if (pointerInteractingRef.current === null) {
          // Quietly observed, not animated.
          phiRef.current += 0.0009;
        }
        state.phi = phiRef.current + pointerMovementRef.current / 240;
        state.width = width * 2;
        state.height = width * 2;
      },
    });

    const fadeIn = setTimeout(() => {
      if (canvasRef.current) canvasRef.current.style.opacity = '1';
    }, 80);

    return () => {
      clearTimeout(fadeIn);
      globe.destroy();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className={cn('relative aspect-square w-full max-w-[720px]', className)}>
      <canvas
        ref={canvasRef}
        onPointerDown={(e) => {
          pointerInteractingRef.current = e.clientX - pointerMovementRef.current;
          if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        }}
        onPointerUp={() => {
          pointerInteractingRef.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
        }}
        onPointerOut={() => {
          pointerInteractingRef.current = null;
          if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
        }}
        onMouseMove={(e) => {
          if (pointerInteractingRef.current !== null) {
            pointerMovementRef.current = e.clientX - pointerInteractingRef.current;
          }
        }}
        onTouchMove={(e) => {
          if (pointerInteractingRef.current !== null && e.touches[0]) {
            pointerMovementRef.current = e.touches[0].clientX - pointerInteractingRef.current;
          }
        }}
        className="size-full opacity-0 transition-opacity duration-1000"
        style={{ cursor: 'grab', contain: 'layout paint size' }}
      />
    </div>
  );
}
