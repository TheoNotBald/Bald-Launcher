const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseGpuEngineInstance,
  parseWindowsGpuPreference,
  summarizeGpuEngineSamples,
} = require('../src/shared/windows-gpu');

test('parses Windows per-application GPU preference values', () => {
  assert.equal(parseWindowsGpuPreference('GpuPreference=2;'), 'high-performance');
  assert.equal(parseWindowsGpuPreference('OtherSetting=1;GpuPreference=1;'), 'power-saving');
  assert.equal(parseWindowsGpuPreference('GpuPreference=0;'), 'system-default');
  assert.equal(parseWindowsGpuPreference(''), 'not-configured');
  assert.equal(parseWindowsGpuPreference('GpuPreference=3;'), 'not-configured');
});

test('extracts the process and adapter identity from a Windows 3D engine counter', () => {
  assert.deepEqual(
    parseGpuEngineInstance('pid_1234_luid_0x00000000_0x0000A123_phys_1_eng_0_engtype_3D'),
    { pid: 1234, luid: '0x00000000_0x0000a123', physicalAdapterIndex: 1 },
  );
  assert.equal(parseGpuEngineInstance('pid_1234_luid_0x00000000_0x0000A123_phys_1_eng_0_engtype_Copy'), null);
  assert.equal(parseGpuEngineInstance('pid_1234_engtype_3D'), null);
});

test('summarizes process-specific GPU engines by adapter without overstating total GPU use', () => {
  const adapters = summarizeGpuEngineSamples([
    {
      instanceName: 'pid_1234_luid_0x00000000_0x0000A123_phys_1_eng_0_engtype_3D',
      utilizationPercent: 18.25,
    },
    {
      instanceName: 'pid_1234_luid_0x00000000_0x0000A123_phys_1_eng_1_engtype_3D',
      utilizationPercent: 35.5,
    },
    {
      instanceName: 'pid_1234_luid_0x00000000_0x0000B456_phys_0_eng_0_engtype_3D',
      utilizationPercent: 2,
    },
    {
      instanceName: 'pid_9999_luid_0x00000000_0x0000C789_phys_0_eng_0_engtype_3D',
      utilizationPercent: 99,
    },
    {
      instanceName: 'pid_1234_luid_0x00000000_0x0000D000_phys_0_eng_0_engtype_3D',
      utilizationPercent: Number.NaN,
    },
    {
      instanceName: 'pid_1234_luid_0x00000000_0x0000E000_phys_0_eng_0_engtype_3D',
      utilizationPercent: 101,
    },
  ], 1234);
  assert.deepEqual(adapters, [
    { luid: '0x00000000_0x0000a123', physicalAdapterIndex: 1, max3dEnginePercent: 35.5 },
    { luid: '0x00000000_0x0000b456', physicalAdapterIndex: 0, max3dEnginePercent: 2 },
  ]);
});
