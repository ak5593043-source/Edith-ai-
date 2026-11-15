import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateFibonacciSphere,
  generateSaturnRingSpecs,
  generateSaturnRingParticles,
  projectAtomicOrbitPath,
  projectDotSphere,
  projectSaturnRings,
} from './dotSphereMath.ts';

test('generateFibonacciSphere distributes points uniformly on a unit sphere', () => {
  const pts = generateFibonacciSphere(420);
  assert.equal(pts.length, 420);

  for (const p of pts) {
    const mag = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
    assert.ok(Math.abs(mag - 1) < 1e-6, `Expected unit radius ~1, got ${mag}`);
  }
});

test('projectDotSphere renders ultra-small micro-dots and expands/energizes during speaking peaks', () => {
  const pts = generateFibonacciSphere(200);
  const idleDots = projectDotSphere({
    points: pts,
    centerX: 160,
    centerY: 160,
    baseRadius: 78,
    rotY: 0.4,
    rotX: 0.2,
    timeSec: 1.5,
    audioLevel: 0,
    mood: 'idle',
  });

  const speakingDots = projectDotSphere({
    points: pts,
    centerX: 160,
    centerY: 160,
    baseRadius: 78,
    rotY: 0.4,
    rotX: 0.2,
    timeSec: 1.5,
    audioLevel: 0.85,
    mood: 'speaking',
  });

  // All dots remain micro-sized (< 2px radius)
  const maxIdleRadius = Math.max(...idleDots.map((d) => d.radius));
  assert.ok(maxIdleRadius < 1.8, `Expected micro dots < 1.8px, got ${maxIdleRadius}`);

  // Sorted back-to-front by z
  for (let i = 1; i < speakingDots.length; i++) {
    assert.ok(speakingDots[i].z >= speakingDots[i - 1].z);
  }

  const avgIdleRadius = idleDots.reduce((s, d) => s + d.radius, 0) / idleDots.length;
  const avgSpeakRadius = speakingDots.reduce((s, d) => s + d.radius, 0) / speakingDots.length;
  assert.ok(avgSpeakRadius > avgIdleRadius);

  const avgSpeakEnergy = speakingDots.reduce((s, d) => s + d.energy, 0) / speakingDots.length;
  const avgIdleEnergy = idleDots.reduce((s, d) => s + d.energy, 0) / idleDots.length;
  assert.ok(avgSpeakEnergy > avgIdleEnergy);
});

test('projectSaturnRings generates 7 3D atom-style orbital shells around all sides that advance continuously over time', () => {
  const specs = generateSaturnRingSpecs(7);
  assert.equal(specs.length, 7);

  // Confirm multi-axis 3D orbital planes spread around [0, PI)
  const uniqueAzimuths = new Set(specs.map((s) => s.planeTiltY.toFixed(3)));
  assert.equal(uniqueAzimuths.size, 7);

  // Confirm continuous 3D orbit trail projection spans front (z > 0) and back (z < 0)
  const orbitPath = projectAtomicOrbitPath({
    spec: specs[0],
    centerX: 160,
    centerY: 160,
    baseRadius: 78,
    timeSec: 0.5,
    audioLevel: 0.2,
    mood: 'idle',
    segments: 60,
  });
  assert.equal(orbitPath.length, 60);
  assert.ok(orbitPath.some((p) => p.z > 0.2), 'Expected orbit front half in front of nucleus');
  assert.ok(orbitPath.some((p) => p.z < -0.2), 'Expected orbit back half behind nucleus');

  const particles = generateSaturnRingParticles(specs);
  assert.ok(particles.length >= 450);

  const t0 = projectSaturnRings({
    particles,
    centerX: 160,
    centerY: 160,
    baseRadius: 78,
    timeSec: 0,
    audioLevel: 0.2,
    mood: 'idle',
  });

  const t1 = projectSaturnRings({
    particles,
    centerX: 160,
    centerY: 160,
    baseRadius: 78,
    timeSec: 1.0,
    audioLevel: 0.2,
    mood: 'idle',
  });

  assert.equal(t0.length, particles.length);
  assert.equal(t1.length, particles.length);

  // Confirm particles visibly orbit/move around the 3D atomic shells between t=0 and t=1
  const avgDelta =
    t0.reduce((sum, dot, idx) => sum + Math.hypot(dot.screenX - t1[idx].screenX, dot.screenY - t1[idx].screenY), 0) /
    t0.length;
  assert.ok(avgDelta > 2.0, `Expected atomic orbital rings to move over time, avgDelta=${avgDelta}`);
});
