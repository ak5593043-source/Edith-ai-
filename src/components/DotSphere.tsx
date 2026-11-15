import React, { useEffect, useRef } from 'react';
import { PlaybackState } from '../hooks/useSpeech.ts';
import {
  generateFibonacciSphere,
  generateSaturnRingSpecs,
  generateSaturnRingParticles,
  projectDotSphere,
  projectSaturnRings,
  projectAtomicOrbitPath,
  ProjectedDot,
  SphereMood,
} from '../utils/dotSphereMath.ts';

interface DotSphereProps {
  playbackState: PlaybackState;
  isListening: boolean;
  isStreaming: boolean;
  getAudioLevel: () => number;
  onTapSphere?: () => void;
}

const LATTICE_POINTS = generateFibonacciSphere(360);
const ATOMIC_RING_SPECS = generateSaturnRingSpecs(7);
const ATOMIC_RING_PARTICLES = generateSaturnRingParticles(ATOMIC_RING_SPECS);

const BUCKET_COUNT = 6;

export const DotSphere: React.FC<DotSphereProps> = ({
  playbackState,
  isListening,
  isStreaming,
  getAudioLevel,
  onTapSphere,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ playbackState, isListening, isStreaming, getAudioLevel });
  stateRef.current = { playbackState, isListening, isStreaming, getAudioLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let rotY = 0;
    let smoothAudio = 0;
    let lastTime = performance.now();

    const sphereBuckets: ProjectedDot[][] = Array.from({ length: BUCKET_COUNT }, () => []);
    const ringBuckets: ProjectedDot[][] = Array.from({ length: BUCKET_COUNT }, () => []);

    const drawBucketedDots = (
      dots: ProjectedDot[],
      buckets: ProjectedDot[][],
      paletteForBucket: (bIdx: number) => string
    ) => {
      for (let b = 0; b < BUCKET_COUNT; b++) {
        buckets[b].length = 0;
      }
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const bIdx = Math.min(
          BUCKET_COUNT - 1,
          Math.max(0, Math.floor((d.depthRatio * 0.72 + d.energy * 0.28) * BUCKET_COUNT))
        );
        buckets[bIdx].push(d);
      }
      for (let b = 0; b < BUCKET_COUNT; b++) {
        const list = buckets[b];
        if (list.length === 0) continue;
        ctx.fillStyle = paletteForBucket(b);
        ctx.beginPath();
        for (let i = 0; i < list.length; i++) {
          const d = list[i];
          ctx.moveTo(d.screenX + d.radius, d.screenY);
          ctx.arc(d.screenX, d.screenY, d.radius, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    };

    const drawOrbitHalf = (
      orbitPts: Array<{ screenX: number; screenY: number; z: number }>,
      frontPass: boolean,
      strokeColor: string
    ) => {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = frontPass ? 0.9 : 0.6;
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i <= orbitPts.length; i++) {
        const pt = orbitPts[i % orbitPts.length];
        const match = frontPass ? pt.z >= 0 : pt.z < 0;
        if (match) {
          if (!drawing) {
            ctx.moveTo(pt.screenX, pt.screenY);
            drawing = true;
          } else {
            ctx.lineTo(pt.screenX, pt.screenY);
          }
        } else {
          drawing = false;
        }
      }
      ctx.stroke();
    };

    const renderFrame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      const timeSec = now / 1000;

      const {
        playbackState: ps,
        isListening: il,
        isStreaming: isStr,
        getAudioLevel: gal,
      } = stateRef.current;

      const mood: SphereMood =
        ps === 'playing'
          ? 'speaking'
          : il
          ? 'listening'
          : isStr || ps === 'loading'
          ? 'thinking'
          : 'idle';

      let targetAudio = gal();
      if (mood === 'listening' && targetAudio < 0.05) {
        targetAudio = 0.22 + 0.14 * Math.sin(timeSec * 7.2) + 0.08 * Math.cos(timeSec * 11.4);
      }
      if (targetAudio > smoothAudio) {
        smoothAudio = smoothAudio * 0.35 + targetAudio * 0.65;
      } else {
        smoothAudio = smoothAudio * 0.84 + targetAudio * 0.16;
      }

      const spinSpeed =
        mood === 'thinking'
          ? 1.15
          : mood === 'speaking'
          ? 0.58 + smoothAudio * 0.65
          : mood === 'listening'
          ? 0.48
          : 0.28;
      rotY += dt * spinSpeed;
      const rotX = 0.22 + Math.sin(timeSec * 0.7) * 0.12;

      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const cssW = canvas.clientWidth || 340;
      const cssH = canvas.clientHeight || 340;
      const targetW = Math.round(cssW * dpr);
      const targetH = Math.round(cssH * dpr);

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const cx = cssW / 2;
      const cy = cssH / 2;
      const baseRadius = Math.min(cssW, cssH) * 0.235;

      // Ambient radial nucleus glow
      const glowRadius = baseRadius * (1.55 + smoothAudio * 0.4);
      const haloGrad = ctx.createRadialGradient(cx, cy, baseRadius * 0.1, cx, cy, glowRadius);
      if (mood === 'speaking') {
        haloGrad.addColorStop(0, `rgba(56, 189, 248, ${0.24 + smoothAudio * 0.2})`);
        haloGrad.addColorStop(0.55, 'rgba(59, 130, 246, 0.08)');
        haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (mood === 'listening') {
        haloGrad.addColorStop(0, `rgba(34, 211, 238, ${0.2 + smoothAudio * 0.16})`);
        haloGrad.addColorStop(0.55, 'rgba(14, 165, 233, 0.07)');
        haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else if (mood === 'thinking') {
        haloGrad.addColorStop(0, 'rgba(129, 140, 248, 0.22)');
        haloGrad.addColorStop(0.6, 'rgba(59, 130, 246, 0.06)');
        haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      } else {
        haloGrad.addColorStop(0, 'rgba(59, 130, 246, 0.14)');
        haloGrad.addColorStop(0.6, 'rgba(30, 58, 138, 0.04)');
        haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      }
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx.fill();

      // Project all 7 multi-axis 3D atomic orbital loops
      const orbitPaths = ATOMIC_RING_SPECS.map((spec) =>
        projectAtomicOrbitPath({
          spec,
          centerX: cx,
          centerY: cy,
          baseRadius,
          timeSec,
          audioLevel: smoothAudio,
          mood,
          segments: 56,
        })
      );

      const sphereDots = projectDotSphere({
        points: LATTICE_POINTS,
        centerX: cx,
        centerY: cy,
        baseRadius,
        rotY,
        rotX,
        timeSec,
        audioLevel: smoothAudio,
        mood,
      });

      const ringDots = projectSaturnRings({
        particles: ATOMIC_RING_PARTICLES,
        centerX: cx,
        centerY: cy,
        baseRadius,
        timeSec,
        audioLevel: smoothAudio,
        mood,
      });

      // Split ring particles cleanly into back (z < 0) and front (z >= 0) passes around nucleus
      const backRings: ProjectedDot[] = [];
      const frontRings: ProjectedDot[] = [];
      for (let i = 0; i < ringDots.length; i++) {
        if (ringDots[i].z < 0) backRings.push(ringDots[i]);
        else frontRings.push(ringDots[i]);
      }

      const ringPalette = (b: number) => {
        const t = b / (BUCKET_COUNT - 1);
        const alpha = (0.28 + t * 0.68).toFixed(2);
        if (mood === 'speaking') return `rgba(${Math.round(80 + t * 145)}, ${Math.round(185 + t * 65)}, 255, ${alpha})`;
        if (mood === 'listening') return `rgba(${Math.round(45 + t * 110)}, ${Math.round(195 + t * 55)}, 255, ${alpha})`;
        if (mood === 'thinking') return `rgba(${Math.round(130 + t * 70)}, ${Math.round(155 + t * 75)}, 255, ${alpha})`;
        return `rgba(${Math.round(70 + t * 90)}, ${Math.round(165 + t * 70)}, 255, ${alpha})`;
      };

      const spherePalette = (b: number) => {
        const t = b / (BUCKET_COUNT - 1);
        const alpha = (0.24 + t * 0.74).toFixed(2);
        if (mood === 'speaking') return `rgba(${Math.round(90 + t * 155)}, ${Math.round(185 + t * 65)}, 255, ${alpha})`;
        if (mood === 'listening') return `rgba(${Math.round(50 + t * 120)}, ${Math.round(200 + t * 55)}, 255, ${alpha})`;
        if (mood === 'thinking') return `rgba(${Math.round(135 + t * 80)}, ${Math.round(155 + t * 80)}, 255, ${alpha})`;
        return `rgba(${Math.round(85 + t * 80)}, ${Math.round(165 + t * 75)}, 255, ${alpha})`;
      };

      const backTraceAlpha = mood === 'speaking' ? 0.14 + smoothAudio * 0.1 : mood === 'listening' ? 0.12 : 0.08;
      const frontTraceAlpha = mood === 'speaking' ? 0.24 + smoothAudio * 0.14 : mood === 'listening' ? 0.22 : 0.16;

      // 1. Back half of the 7 3D atomic orbital tracks & moving electron micro-dots
      for (let rIdx = 0; rIdx < orbitPaths.length; rIdx++) {
        drawOrbitHalf(
          orbitPaths[rIdx],
          false,
          rIdx % 2 === 0
            ? `rgba(96, 165, 250, ${backTraceAlpha})`
            : `rgba(56, 189, 248, ${backTraceAlpha})`
        );
      }
      drawBucketedDots(backRings, ringBuckets, ringPalette);

      // 2. Micro-dot central 3D sphere nucleus
      drawBucketedDots(sphereDots, sphereBuckets, spherePalette);

      // 3. Front half of the 7 3D atomic orbital tracks & moving electron micro-dots
      for (let rIdx = 0; rIdx < orbitPaths.length; rIdx++) {
        drawOrbitHalf(
          orbitPaths[rIdx],
          true,
          rIdx % 2 === 0
            ? `rgba(96, 165, 250, ${frontTraceAlpha})`
            : `rgba(56, 189, 248, ${frontTraceAlpha})`
        );
      }
      drawBucketedDots(frontRings, ringBuckets, ringPalette);

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <button
      type="button"
      onClick={onTapSphere}
      data-testid="dot-sphere-trigger"
      aria-label="EDITH Voice Reactive Dot Sphere - Tap to toggle listening"
      className="relative flex items-center justify-center w-80 h-80 sm:w-96 sm:h-96 bg-transparent border-0 p-0 cursor-pointer focus:outline-none select-none"
    >
      <canvas
        ref={canvasRef}
        data-testid="dot-sphere-canvas"
        className="w-full h-full block"
      />
    </button>
  );
};
