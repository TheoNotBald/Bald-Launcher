'use strict';

(function exposeCapeProjectModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CapeProjectModel = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const WIDTH = 64;
  const HEIGHT = 32;
  const MAX_FRAMES = 30;
  const MAX_DURATION_MS = 60000;
  const DEFAULT_DELAY_MS = 100;

  function clampInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.round(number)));
  }

  function createFrame(pixels, delayMs = DEFAULT_DELAY_MS) {
    const framePixels = pixels instanceof Uint8ClampedArray && pixels.length === WIDTH * HEIGHT * 4
      ? new Uint8ClampedArray(pixels)
      : new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    return { pixels: framePixels, delayMs: clampInteger(delayMs, 20, MAX_DURATION_MS, DEFAULT_DELAY_MS) };
  }

  function createProject(input = {}) {
    const sourceFrames = Array.isArray(input.frames) && input.frames.length ? input.frames : [{}];
    const frames = sourceFrames.slice(0, MAX_FRAMES).map(frame => createFrame(frame?.pixels, frame?.delayMs));
    return {
      format: 'baldcape',
      version: 1,
      width: WIDTH,
      height: HEIGHT,
      name: String(input.name || 'My Cape').trim().slice(0, 120) || 'My Cape',
      loop: input.loop !== false,
      frames,
      modifiedAt: new Date().toISOString(),
    };
  }

  function addFrame(project, pixels, delayMs) {
    const next = createProject(project);
    if (next.frames.length >= MAX_FRAMES) throw new Error(`Cape animations support at most ${MAX_FRAMES} frames.`);
    next.frames.push(createFrame(pixels, delayMs));
    next.modifiedAt = new Date().toISOString();
    return next;
  }

  function updateFrame(project, index, changes = {}) {
    const next = createProject(project);
    const frameIndex = clampInteger(index, 0, next.frames.length - 1, 0);
    const current = next.frames[frameIndex];
    next.frames[frameIndex] = createFrame(changes.pixels || current.pixels, changes.delayMs ?? current.delayMs);
    next.modifiedAt = new Date().toISOString();
    return next;
  }

  function removeFrame(project, index) {
    const next = createProject(project);
    if (next.frames.length <= 1) return next;
    const frameIndex = clampInteger(index, 0, next.frames.length - 1, 0);
    next.frames.splice(frameIndex, 1);
    next.modifiedAt = new Date().toISOString();
    return next;
  }

  function totalDuration(project) {
    return createProject(project).frames.reduce((sum, frame) => sum + frame.delayMs, 0);
  }

  function serialize(project) {
    const normalized = createProject(project);
    return {
      format: normalized.format,
      version: normalized.version,
      width: normalized.width,
      height: normalized.height,
      name: normalized.name,
      loop: normalized.loop,
      frames: normalized.frames.map(frame => ({
        delayMs: frame.delayMs,
        pixels: Array.from(frame.pixels),
      })),
      modifiedAt: normalized.modifiedAt,
    };
  }

  return {
    WIDTH,
    HEIGHT,
    MAX_FRAMES,
    MAX_DURATION_MS,
    createFrame,
    createProject,
    addFrame,
    updateFrame,
    removeFrame,
    totalDuration,
    serialize,
  };
});
