const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getCurseForgeSha1,
  getCurseForgeFingerprint,
  isCurseForgeServerCompatible,
  getCurseForgeSideLabel,
  getModrinthSideLabel,
  isModrinthServerCompatible,
  mapCurseForgeProjectType,
  selectCurseForgeFile,
  selectModrinthVersion,
} = require('../src/content/content-provider-utils');

test('Modrinth install defaults to the newest stable and uses its primary file', () => {
  const versions = [
    { id: 'beta', version_type: 'beta', files: [{ url: 'beta.jar', primary: true }] },
    { id: 'release', version_type: 'release', files: [{ url: 'extra.jar' }, { url: 'release.jar', primary: true }] },
  ];
  assert.equal(selectModrinthVersion(versions).version.id, 'release');
  assert.equal(selectModrinthVersion(versions).file.url, 'release.jar');
  assert.equal(selectModrinthVersion(versions, 'beta').version.id, 'beta');
});

test('CurseForge install defaults to a release and accepts an explicit file ID', () => {
  const files = [
    { id: 3, releaseType: 2, downloadUrl: 'beta.jar' },
    { id: 2, releaseType: 1, downloadUrl: 'release.jar' },
  ];
  assert.equal(selectCurseForgeFile(files).id, 2);
  assert.equal(selectCurseForgeFile(files, 3).id, 3);
});

test('CurseForge project classes preserve plugin and content type identities', () => {
  assert.equal(mapCurseForgeProjectType(5), 'plugin');
  assert.equal(mapCurseForgeProjectType(6), 'mod');
  assert.equal(mapCurseForgeProjectType(12), 'resourcepack');
  assert.equal(mapCurseForgeProjectType(6552), 'shader');
  assert.equal(mapCurseForgeProjectType(6945), 'datapack');
  assert.equal(mapCurseForgeProjectType(999), null);
});

test('server mod compatibility excludes client-only and unknown Modrinth projects', () => {
  assert.equal(isModrinthServerCompatible({ server_side: 'required' }), true);
  assert.equal(isModrinthServerCompatible({ server_side: 'optional' }), true);
  assert.equal(isModrinthServerCompatible({ server_side: 'unsupported' }), false);
  assert.equal(isModrinthServerCompatible({ server_side: 'unknown' }), false);
  assert.equal(isModrinthServerCompatible({ environment: 'server_only' }), true);
  assert.equal(isModrinthServerCompatible({ environment: 'client_or_server_prefers_both' }), true);
  assert.equal(isModrinthServerCompatible({ environment: 'unknown' }), true);
  assert.equal(isModrinthServerCompatible({ environment: 'client_only' }), false);
  assert.equal(getModrinthSideLabel({ client_side: 'unsupported', server_side: 'required' }), 'Server only');
  assert.equal(getModrinthSideLabel({ client_side: 'required', server_side: 'required' }), 'Server or Client');
  assert.equal(getModrinthSideLabel({ client_side: 'optional', server_side: 'optional' }), 'Server or Client');
  assert.equal(getModrinthSideLabel({ environment: 'client_or_server_prefers_both' }), 'Server or Client');
  assert.equal(getModrinthSideLabel({ environment: 'server_only' }), 'Server only');
  assert.equal(getCurseForgeSideLabel({}), 'Unknown side');
  assert.equal(getCurseForgeSideLabel({ clientSide: 'required', serverSide: 'required' }), 'Server or Client');
  assert.equal(isCurseForgeServerCompatible({ clientSide: 'required', serverSide: 'unsupported' }), false);
  assert.equal(isCurseForgeServerCompatible({}), true);
});

test('CurseForge SHA-1 is read from the API hash array', () => {
  assert.equal(getCurseForgeSha1({ hashes: [{ algo: 0, value: 'md5' }, { algo: 1, value: 'sha1' }] }), 'sha1');
});

test('CurseForge fingerprints ignore whitespace bytes', () => {
  assert.equal(getCurseForgeFingerprint(Buffer.from('hello')), 2788266382);
  assert.equal(getCurseForgeFingerprint(Buffer.from('A \n\tB\rC')), getCurseForgeFingerprint(Buffer.from('ABC')));
});
