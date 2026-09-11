'use strict';

(function exposeCapeProjectModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CapeProjectModel = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  const WIDTH = 64;
  const HEIGHT = 32;
  const RESOLUTIONS = Object.freeze({
    '64x32': [64, 32],
    '128x64': [128, 64],
    '256x128': [256, 128],
  });
  const MAX_FRAMES = 30;
  const MAX_DURATION_MS = 60000;
  const DEFAULT_DELAY_MS = 100;

  function clampInteger(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, Math.round(number)));
  }

  function normalizePixels(pixels, width = WIDTH, height = HEIGHT) {
    if (pixels instanceof Uint8ClampedArray && pixels.length === width * height * 4) {
      return new Uint8ClampedArray(pixels);
    }
    if (Array.isArray(pixels) && pixels.length === width * height * 4) {
      return new Uint8ClampedArray(pixels);
    }
    return new Uint8ClampedArray(width * height * 4);
  }

  function createFrame(pixels, delayMs = DEFAULT_DELAY_MS, width = WIDTH, height = HEIGHT) {
    return {
      width,
      height,
      pixels: normalizePixels(pixels, width, height),
      delayMs: clampInteger(delayMs, 20, MAX_DURATION_MS, DEFAULT_DELAY_MS)
    };
  }

  function createProject(input = {}) {
    const resolution = RESOLUTIONS[`${input.width}x${input.height}`] || [WIDTH, HEIGHT];
    const [width, height] = resolution;
    const sourceFrames = Array.isArray(input.frames) && input.frames.length ? input.frames : [{}];
    const frames = sourceFrames.slice(0, MAX_FRAMES).map(frame => createFrame(frame?.pixels, frame?.delayMs, width, height));
    return {
      format: 'baldcape',
      version: 1,
      width,
      height,
      name: String(input.name || 'My Cape').trim().slice(0, 120) || 'My Cape',
      loop: input.loop !== false,
      frames,
      modifiedAt: new Date().toISOString(),
    };
  }

  function addFrame(project, pixels, delayMs) {
    const next = createProject(project);
    if (next.frames.length >= MAX_FRAMES) throw new Error(`Cape animations support at most ${MAX_FRAMES} frames.`);
    next.frames.push(createFrame(pixels, delayMs, next.width, next.height));
    next.modifiedAt = new Date().toISOString();
    return next;
  }

  function updateFrame(project, index, changes = {}) {
    const next = createProject(project);
    const frameIndex = clampInteger(index, 0, next.frames.length - 1, 0);
    const current = next.frames[frameIndex];
    next.frames[frameIndex] = createFrame(changes.pixels || current.pixels, changes.delayMs ?? current.delayMs, next.width, next.height);
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
        width: normalized.width,
        height: normalized.height,
        delayMs: frame.delayMs,
        pixels: Array.from(frame.pixels),
      })),
      modifiedAt: normalized.modifiedAt,
    };
  }

  return {
    WIDTH,
    HEIGHT,
    RESOLUTIONS,
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
