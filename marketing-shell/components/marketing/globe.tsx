'use client';

import { useEffect, useRef } from 'react';
import createGlobe, { type COBEOptions } from 'cobe';
import { cn } from '@/lib/utils';

// Tuned for a publication-plate feel, not a tech demo: deep inky sphere,
// finer dot density, slower rotation. No frame around it — just the
// sphere sitting in atmosphere.
const GLOBE_CONFIG: COBEOptions = {
  width: 800,
  height: 800,
  onRender: () => {},
  devicePixelRatio: 2,
  phi: 0,
  theta: 0.24,
  dark: 1,
  diffuse: 0.6,
  // Denser land sampling + cobe's default brightness restored — continents
  // read as defined ivory mass instead of barely-visible specks. Cities
  // (markers) sit on top as slightly heavier accents.
  mapSamples: 32000,
  mapBrightness: 6.5,
  baseColor: [0.025, 0.05, 0.11],
  markerColor: [0.98, 0.98, 0.97],
  glowColor: [0.07, 0.12, 0.22],
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
  const phiRef = useRef(0);
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
      {/* Outer atmospheric haze — gives the sphere its weight without framing it */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[-12%] -z-10"
        style={{
          background:
            'radial-gradient(circle at center, rgba(22, 44, 90, 0.55), transparent 58%)',
          filter: 'blur(36px)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[-4%] -z-10"
        style={{
          background:
            'radial-gradient(circle at center, rgba(40, 70, 130, 0.18), transparent 65%)',
        }}
      />
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
