export type SphereMood = 'idle' | 'listening' | 'speaking' | 'thinking';

export interface LatticePoint {
  x: number;
  y: number;
  z: number;
  theta: number;
  phi: number;
}

export interface SaturnRingSpec {
  ringIndex: number;
  radiusMultiplier: number;
  particleCount: number;
  angularVelocity: number;
  phaseOffset: number;
  tiltOffsetX: number;
  tiltOffsetZ: number;
  planeTiltX: number;
  planeTiltY: number;
  planeTiltZ: number;
  precessSpeed: number;
  alpha: number;
}

export interface RingParticle {
  ringIndex: number;
  angle: number;
  radialJitter: number;
  verticalJitter: number;
  sizeJitter: number;
  angularVelocity: number;
  radiusMultiplier: number;
  tiltOffsetX: number;
  tiltOffsetZ: number;
  planeTiltX: number;
  planeTiltY: number;
  planeTiltZ: number;
  precessSpeed: number;
  alpha: number;
}

export interface ProjectedDot {
  screenX: number;
  screenY: number;
  z: number;
  depthRatio: number; // 0 (back) .. 1 (front)
  radius: number;
  energy: number; // 0..1 voice displacement intensity
  isRing?: boolean;
  ringIndex?: number;
}

/**
 * Generates an evenly distributed 3D Fibonacci sphere lattice of points on a unit sphere.
 */
export function generateFibonacciSphere(count = 420): LatticePoint[] {
  const safeCount = Math.max(12, Math.floor(count));
  const points: LatticePoint[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < safeCount; i++) {
    const y = 1 - (i / (safeCount - 1)) * 2; // 1 to -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = goldenAngle * i;
    const x = Math.cos(phi) * r;
    const z = Math.sin(phi) * r;
    const theta = Math.acos(Math.max(-1, Math.min(1, y)));

    points.push({ x, y, z, theta, phi });
  }

  return points;
}

/**
 * Creates 7 intersecting 3D atomic orbital ring specifications distributed isotropically around
 * all sides of the central sphere core with alternating orbital directions & gentle plane precession.
 */
export function generateSaturnRingSpecs(ringCount = 7): SaturnRingSpec[] {
  const safeCount = Math.max(6, Math.min(8, Math.floor(ringCount)));
  const specs: SaturnRingSpec[] = [];

  for (let i = 0; i < safeCount; i++) {
    const t = i / Math.max(1, safeCount - 1);
    // Compact atomic orbital radii wrapping all sides of the sphere cleanly
    const radiusMultiplier = 1.38 + (i % 3) * 0.14 + t * 0.16; // 1.38R .. 1.82R
    const direction = i % 2 === 0 ? 1 : -1;
    const angularVelocity = direction * (0.95 - (i % 3) * 0.14);
    const particleCount = Math.round(74 + (i % 3) * 10);

    // Multi-axis 3D orbital angles (atom electron shell layout around all 3 axes)
    const planeTiltX = 0.42 + ((i * 0.47) % 1.05);
    const planeTiltY = (i * Math.PI) / safeCount;
    const planeTiltZ = ((i % 2 === 0 ? 1 : -1) * (0.28 + t * 0.85));
    const precessSpeed = direction * (0.14 + (i % 3) * 0.04);

    const tiltOffsetX = Math.sin(i * 1.37) * 0.03;
    const tiltOffsetZ = Math.cos(i * 1.91) * 0.03;
    const alpha = 0.62 + (1 - Math.abs(t - 0.5)) * 0.32;

    specs.push({
      ringIndex: i,
      radiusMultiplier,
      particleCount,
      angularVelocity,
      phaseOffset: i * 0.92,
      tiltOffsetX,
      tiltOffsetZ,
      planeTiltX,
      planeTiltY,
      planeTiltZ,
      precessSpeed,
      alpha,
    });
  }

  return specs;
}

/**
 * Precomputes static unit-ring particle attributes once so the animation loop performs zero allocations.
 */
export function generateSaturnRingParticles(specs: SaturnRingSpec[]): RingParticle[] {
  const particles: RingParticle[] = [];

  for (const ring of specs) {
    for (let j = 0; j < ring.particleCount; j++) {
      const seed = (ring.ringIndex + 1) * 9301 + j * 49297;
      const hashA = Math.abs(Math.sin(seed * 0.0013)) % 1;
      const hashB = Math.abs(Math.cos(seed * 0.0029)) % 1;
      const hashC = Math.abs(Math.sin(seed * 0.0047)) % 1;

      const angle = (j / ring.particleCount) * Math.PI * 2 + ring.phaseOffset + (hashA - 0.5) * 0.06;
      particles.push({
        ringIndex: ring.ringIndex,
        angle,
        radialJitter: (hashA - 0.5) * 0.028,
        verticalJitter: (hashB - 0.5) * 0.014,
        sizeJitter: 0.72 + hashC * 0.56,
        angularVelocity: ring.angularVelocity,
        radiusMultiplier: ring.radiusMultiplier,
        tiltOffsetX: ring.tiltOffsetX,
        tiltOffsetZ: ring.tiltOffsetZ,
        planeTiltX: ring.planeTiltX,
        planeTiltY: ring.planeTiltY,
        planeTiltZ: ring.planeTiltZ,
        precessSpeed: ring.precessSpeed,
        alpha: ring.alpha,
      });
    }
  }

  return particles;
}

/**
 * Applies 3D atomic orbital Euler rotations (X inclination -> Y orbital azimuth precession -> Z cant)
 * and projects into 2D screen space.
 */
function transformAndProjectOrbitPoint(
  rx: number,
  ry: number,
  rz: number,
  planeTiltX: number,
  planeTiltY: number,
  planeTiltZ: number,
  centerX: number,
  centerY: number,
  baseRadius: number,
  perspective: number
): { screenX: number; screenY: number; z: number; scale: number } {
  // 1. Rotate around X (orbital inclination)
  const cosX = Math.cos(planeTiltX);
  const sinX = Math.sin(planeTiltX);
  const y1 = ry * cosX - rz * sinX;
  const z1 = ry * sinX + rz * cosX;
  const x1 = rx;

  // 2. Rotate around Y (orbital azimuth spin around nucleus)
  const cosY = Math.cos(planeTiltY);
  const sinY = Math.sin(planeTiltY);
  const x2 = x1 * cosY - z1 * sinY;
  const z2 = x1 * sinY + z1 * cosY;
  const y2 = y1;

  // 3. Rotate around Z (diagonal shell angle)
  const cosZ = Math.cos(planeTiltZ);
  const sinZ = Math.sin(planeTiltZ);
  const x3 = x2 * cosZ - y2 * sinZ;
  const y3 = x2 * sinZ + y2 * cosZ;
  const z3 = z2;

  const zPx = z3 * baseRadius;
  const scale = perspective / Math.max(40, perspective - zPx);

  return {
    screenX: centerX + x3 * baseRadius * scale,
    screenY: centerY + y3 * baseRadius * scale,
    z: z3,
    scale,
  };
}

/**
 * Projects a continuous 3D orbital loop path for rendering the glowing thin atomic ring trails.
 */
export function projectAtomicOrbitPath(params: {
  spec: SaturnRingSpec;
  centerX: number;
  centerY: number;
  baseRadius: number;
  timeSec: number;
  audioLevel: number;
  mood: SphereMood;
  segments?: number;
}): Array<{ screenX: number; screenY: number; z: number }> {
  const { spec, centerX, centerY, baseRadius, timeSec, audioLevel, mood, segments = 60 } = params;
  const clampedAudio = Math.max(0, Math.min(1, audioLevel));
  const perspective = baseRadius * 7.2;
  const precessBoost = mood === 'thinking' ? 1.8 : mood === 'speaking' ? 1.35 : 1.0;

  const tx = spec.planeTiltX + Math.sin(timeSec * 0.4 + spec.ringIndex) * 0.08;
  const ty = spec.planeTiltY + timeSec * spec.precessSpeed * precessBoost;
  const tz = spec.planeTiltZ + Math.cos(timeSec * 0.35 + spec.ringIndex) * 0.06;

  const r = spec.radiusMultiplier * (1 + clampedAudio * 0.055);
  const out: Array<{ screenX: number; screenY: number; z: number }> = new Array(segments);

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const rx = Math.cos(angle) * r;
    const rz = Math.sin(angle) * r;
    const proj = transformAndProjectOrbitPoint(
      rx,
      0,
      rz,
      tx,
      ty,
      tz,
      centerX,
      centerY,
      baseRadius,
      perspective
    );
    out[i] = { screenX: proj.screenX, screenY: proj.screenY, z: proj.z };
  }

  return out;
}

/**
 * Projects 3D Fibonacci lattice points into 2D screen coordinates with micro-dot sizing
 * and real-time voice-reactive spherical harmonic ripples.
 */
export function projectDotSphere(params: {
  points: LatticePoint[];
  centerX: number;
  centerY: number;
  baseRadius: number;
  rotY: number;
  rotX: number;
  timeSec: number;
  audioLevel: number; // 0..1
  mood: SphereMood;
}): ProjectedDot[] {
  const {
    points,
    centerX,
    centerY,
    baseRadius,
    rotY,
    rotX,
    timeSec,
    audioLevel,
    mood,
  } = params;

  const clampedAudio = Math.max(0, Math.min(1, audioLevel));
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);

  const perspective = baseRadius * 3.8;
  const projected: ProjectedDot[] = new Array(points.length);

  const breath =
    mood === 'speaking'
      ? 1 + clampedAudio * 0.14
      : mood === 'listening'
      ? 1 + 0.04 * Math.sin(timeSec * 3.6) + clampedAudio * 0.11
      : mood === 'thinking'
      ? 1 + 0.035 * Math.sin(timeSec * 5.2)
      : 1 + 0.02 * Math.sin(timeSec * 1.8);

  const waveStrength =
    mood === 'speaking'
      ? 0.05 + clampedAudio * 0.22
      : mood === 'listening'
      ? 0.035 + clampedAudio * 0.15
      : mood === 'thinking'
      ? 0.055
      : 0.015;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];

    const harmonic =
      Math.sin(p.theta * 4 + timeSec * (mood === 'speaking' ? 8.5 : 3.2)) *
      Math.cos(p.phi * 3 - timeSec * (mood === 'speaking' ? 6.2 : 2.1));

    const radialFactor = breath + harmonic * waveStrength;
    const px = p.x * radialFactor;
    const py = p.y * radialFactor;
    const pz = p.z * radialFactor;

    const x1 = px * cosY - pz * sinY;
    const z1 = px * sinY + pz * cosY;
    const y2 = py * cosX - z1 * sinX;
    const z2 = py * sinX + z1 * cosX;

    const zPx = z2 * baseRadius;
    const scale = perspective / Math.max(40, perspective - zPx);

    const screenX = centerX + x1 * baseRadius * scale;
    const screenY = centerY + y2 * baseRadius * scale;

    const depthRatio = Math.max(0, Math.min(1, (z2 + 1.25) / 2.5));
    const energy = Math.max(0, Math.min(1, Math.abs(harmonic) * waveStrength * 3.8 + clampedAudio * 0.55));
    // Ultra-fine pinpoint micro-dots (0.50px .. 1.30px)
    const dotRadius =
      (0.5 + depthRatio * 0.54 + (mood === 'speaking' ? energy * 0.4 : energy * 0.22)) *
      Math.max(0.75, scale * 0.88);

    projected[i] = {
      screenX,
      screenY,
      z: z2,
      depthRatio,
      radius: dotRadius,
      energy,
      isRing: false,
    };
  }

  projected.sort((a, b) => a.z - b.z);
  return projected;
}

/**
 * Projects continuously orbiting 3D atomic ring micro-particles around all sides of the central sphere,
 * synchronized identically with projectAtomicOrbitPath and pulsing with voice energy.
 */
export function projectSaturnRings(params: {
  particles: RingParticle[];
  centerX: number;
  centerY: number;
  baseRadius: number;
  timeSec: number;
  audioLevel: number;
  mood: SphereMood;
}): ProjectedDot[] {
  const { particles, centerX, centerY, baseRadius, timeSec, audioLevel, mood } = params;
  const clampedAudio = Math.max(0, Math.min(1, audioLevel));
  const perspective = baseRadius * 7.2;

  const speedBoost =
    mood === 'speaking'
      ? 1.4 + clampedAudio * 1.1
      : mood === 'listening'
      ? 1.2 + clampedAudio * 0.85
      : mood === 'thinking'
      ? 1.85
      : 1.0;

  const precessBoost = mood === 'thinking' ? 1.8 : mood === 'speaking' ? 1.35 : 1.0;
  const projected: ProjectedDot[] = new Array(particles.length);

  for (let i = 0; i < particles.length; i++) {
    const pt = particles[i];
    const currentAngle = pt.angle + timeSec * pt.angularVelocity * speedBoost;

    const ringPulse =
      clampedAudio * 0.065 * Math.sin(currentAngle * 3 - timeSec * 7 + pt.ringIndex * 0.8);
    const r = pt.radiusMultiplier * (1 + clampedAudio * 0.055) + pt.radialJitter + ringPulse;

    const rx = Math.cos(currentAngle) * r;
    const rz = Math.sin(currentAngle) * r;
    const ry = pt.verticalJitter + clampedAudio * 0.025 * Math.cos(currentAngle * 2 + pt.ringIndex);

    const tx = pt.planeTiltX + Math.sin(timeSec * 0.4 + pt.ringIndex) * 0.08 + pt.tiltOffsetX * 0.25;
    const ty = pt.planeTiltY + timeSec * pt.precessSpeed * precessBoost;
    const tz = pt.planeTiltZ + Math.cos(timeSec * 0.35 + pt.ringIndex) * 0.06 + pt.tiltOffsetZ * 0.25;

    const proj = transformAndProjectOrbitPoint(
      rx,
      ry,
      rz,
      tx,
      ty,
      tz,
      centerX,
      centerY,
      baseRadius,
      perspective
    );

    const depthRatio = Math.max(0, Math.min(1, (proj.z + 1.9) / 3.8));
    const energy = Math.max(
      0,
      Math.min(1, pt.alpha * 0.48 + clampedAudio * 0.55 + 0.16 * Math.sin(currentAngle * 2 + timeSec * 4))
    );
    // Ultra-fine dust micro-dots orbiting the atomic rings (0.44px .. 1.15px)
    const dotRadius =
      (0.44 + depthRatio * 0.42 + clampedAudio * 0.24) * pt.sizeJitter * Math.max(0.76, proj.scale * 0.88);

    projected[i] = {
      screenX: proj.screenX,
      screenY: proj.screenY,
      z: proj.z,
      depthRatio,
      radius: dotRadius,
      energy,
      isRing: true,
      ringIndex: pt.ringIndex,
    };
  }

  projected.sort((a, b) => a.z - b.z);
  return projected;
}
