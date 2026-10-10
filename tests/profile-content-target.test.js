const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'bald_launcher_v7.html'), 'utf8').replace(/\r\n/g, '\n');

test('removing content targets the requested profile and deletes the installed filename', async () => {
  const start = main.indexOf("ipcMain.handle('launcher:remove-content'");
  const end = main.indexOf('\n});\n\n// Disabling content renames', start);
  assert.ok(start >= 0 && end > start, 'remove-content IPC handler should exist');

  const activeProfile = { id: 'active', mods: [{ id: 'unrelated', name: 'Unrelated', type: 'mod' }] };
  const targetProfile = { id: 'target', mods: [{ id: 'probe', name: 'Different Project Name', type: 'mod', fileName: 'different-download-name.jar' }] };
  const removedFiles = [];
  const context = {
    ipcMain: { handle: (_channel, handler) => { context.removeContent = handler; } },
    launcherState: { activeProfileId: 'active', profiles: [activeProfile, targetProfile] },
    getActiveProfile: () => activeProfile,
    resolveInstalledContentPath: (_profile, entry, disabled) => `mods/${entry.fileName}${disabled ? '.disabled' : ''}`,
    getInstalledFilePath: (_profile, _type, name, disabled) => `mods/${name}.jar${disabled ? '.disabled' : ''}`,
    fs: {
      existsSync: file => file === 'mods/different-download-name.jar',
      unlinkSync: file => removedFiles.push(file),
    },
    scheduleStateWrite() {},
  };
  vm.runInNewContext(main.slice(start, end + '\n});'.length), context);

  const result = await context.removeContent({}, { profileId: 'target', id: 'probe' });
  assert.equal(result.ok, true);
  assert.deepEqual(removedFiles, ['mods/different-download-name.jar']);
  assert.deepEqual(targetProfile.mods, []);
  assert.deepEqual(activeProfile.mods.map(entry => entry.id), ['unrelated']);
});

test('profile content controls pass their selected profile ID through IPC', () => {
  assert.match(html, /launcherBridge\.toggleContent\(\{ profileId: p\.id, id \}\)/);
  assert.match(html, /launcherBridge\.removeContent\(\{ profileId: p\.id, id \}\)/);
});
