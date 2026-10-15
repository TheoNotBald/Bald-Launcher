'use strict';

function parseWindowsGpuPreference(value) {
  const match = String(value || '').match(/(?:^|;)\s*GpuPreference\s*=\s*([012])\s*(?:;|$)/i);
  if (!match) return 'not-configured';
  if (match[1] === '2') return 'high-performance';
  if (match[1] === '1') return 'power-saving';
  return 'system-default';
}

function parseGpuEngineInstance(instanceName) {
  const value = String(instanceName || '');
  if (!/engtype_3D/i.test(value)) return null;
  const luid = value.match(/luid_(0x[0-9a-f]+)(?:_(0x[0-9a-f]+))?_phys_(\d+)/i);
  const pid = value.match(/(?:^|_)pid_(\d+)(?:_|$)/i);
  if (!luid || !pid) return null;
  return {
    pid: Number(pid[1]),
    luid: [luid[1], luid[2]].filter(Boolean).join('_').toLowerCase(),
    physicalAdapterIndex: Number(luid[3]),
  };
}

function summarizeGpuEngineSamples(samples, expectedPid = null) {
  const adapters = new Map();
  for (const sample of Array.isArray(samples) ? samples : []) {
    const parsed = parseGpuEngineInstance(sample?.instanceName);
    const utilizationPercent = Number(sample?.utilizationPercent);
    if (!parsed || !Number.isFinite(utilizationPercent) || utilizationPercent < 0 || utilizationPercent > 100) continue;
    if (Number.isInteger(Number(expectedPid)) && Number(expectedPid) > 0 && parsed.pid !== Number(expectedPid)) continue;
    const key = `${parsed.luid}:${parsed.physicalAdapterIndex}`;
    const adapter = adapters.get(key) || {
      luid: parsed.luid,
      physicalAdapterIndex: parsed.physicalAdapterIndex,
      max3dEnginePercent: 0,
    };
    adapter.max3dEnginePercent = Math.max(adapter.max3dEnginePercent, utilizationPercent);
    adapters.set(key, adapter);
  }
  return [...adapters.values()].sort((left, right) => left.luid.localeCompare(right.luid)
    || left.physicalAdapterIndex - right.physicalAdapterIndex);
}

module.exports = {
  parseGpuEngineInstance,
  parseWindowsGpuPreference,
  summarizeGpuEngineSamples,
};
