const fs = require('node:fs');
const path = require('node:path');

function commitStagedFiles(stagedFiles, fileSystem = fs) {
  if (!Array.isArray(stagedFiles) || stagedFiles.length === 0) return [];

  const targets = new Set();
  const entries = stagedFiles.map(({ stagedPath, targetPath }) => {
    const staged = path.resolve(stagedPath);
    const target = path.resolve(targetPath);
    if (targets.has(target)) throw new Error(`Multiple staged files target ${target}.`);
    targets.add(target);
    if (!fileSystem.statSync(staged).isFile()) throw new Error(`Staged file is not a regular file: ${staged}`);
    if (fileSystem.existsSync(target)) throw new Error(`Refusing to overwrite existing file: ${target}`);
    return { stagedPath: staged, targetPath: target };
  });

  for (const entry of entries) {
    fileSystem.mkdirSync(path.dirname(entry.targetPath), { recursive: true });
  }

  const committed = [];
  try {
    for (const entry of entries) {
      fileSystem.renameSync(entry.stagedPath, entry.targetPath);
      committed.push(entry.targetPath);
    }
    return committed;
  } catch (error) {
    const rollbackErrors = [];
    for (const targetPath of committed.reverse()) {
      try {
        fileSystem.unlinkSync(targetPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        `File commit failed and rollback was incomplete: ${rollbackErrors.map(item => item.message).join('; ')}`,
      );
    }
    throw error;
  }
}

module.exports = { commitStagedFiles };
