'use strict';

const VIDEO_PRESETS = {
  'max-fps-pvp': {
    graphicsMode: '0',
    renderClouds: '"false"',
    cloudRange: '0',
    particles: '2',
    mipmapLevels: '0',
    biomeBlendRadius: '0',
    entityDistanceScaling: '0.5',
    ao: 'false',
    entityShadows: 'false',
    textureFiltering: '0',
    maxAnisotropyBit: '0',
    prioritizeChunkUpdates: '1',
  },
  'balanced-pvp': {
    graphicsMode: '0',
    renderClouds: '"false"',
    cloudRange: '0',
    particles: '1',
    mipmapLevels: '2',
    biomeBlendRadius: '2',
    entityDistanceScaling: '1.0',
    ao: 'true',
    entityShadows: 'false',
    textureFiltering: '1',
    maxAnisotropyBit: '1',
    prioritizeChunkUpdates: '1',
  },
  quality: {
    graphicsMode: '2',
    renderClouds: '"true"',
    cloudRange: '128',
    particles: '0',
    mipmapLevels: '4',
    biomeBlendRadius: '5',
    entityDistanceScaling: '5.0',
    ao: 'true',
    entityShadows: 'true',
    textureFiltering: '2',
    maxAnisotropyBit: '3',
    prioritizeChunkUpdates: '2',
  },
};

function applyMinecraftVideoPreset(contents, settings = {}) {
  const preset = VIDEO_PRESETS[settings.performancePreset] || VIDEO_PRESETS['balanced-pvp'];
  const options = new Map();
  for (const line of String(contents || '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) options.set(line.slice(0, separator), line.slice(separator + 1));
  }

  const configuredFps = String(settings.fpsCap || 'Unlimited').toLowerCase();
  const maxFps = configuredFps === 'unlimited' ? 260 : Math.min(260, Math.max(10, Number.parseInt(configuredFps, 10) || 260));
  const requestedRenderDistance = Math.min(32, Math.max(2, Number(settings.renderDistance) || 12));
  const requestedSimulationDistance = Math.min(32, Math.max(5, Number(settings.simulationDistance) || 8));
  const values = {
    ...preset,
    graphicsPreset: '"custom"',
    enableVsync: 'false',
    maxFps: String(maxFps),
    renderDistance: String(requestedRenderDistance),
    simulationDistance: String(requestedSimulationDistance),
  };

  for (const [key, value] of Object.entries(values)) options.set(key, value);
  return `${Array.from(options, ([key, value]) => `${key}:${value}`).join('\n')}\n`;
}

module.exports = { applyMinecraftVideoPreset };
