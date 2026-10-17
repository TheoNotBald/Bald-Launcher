'use strict';

const path = require('node:path');

function resolveProfileImportPath(root, value) {
  const relative = String(value || '').replace(/\\/g, '/');
  if (!relative || relative.includes('\0') || relative.startsWith('/') || /^[a-z]:/i.test(relative)) return null;
  const segments = relative.split('/');
  if (segments.some(segment => segment === '..' || segment === '.')) return null;
  const destination = path.resolve(root, ...segments);
  const fromRoot = path.relative(path.resolve(root), destination);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) return null;
  return { relative, destination };
}

async function runProfileImportDownloads({
  files,
  destinationRoot,
  downloadFile,
  onProgress = () => {},
  concurrency = 4,
}) {
  const items = Array.isArray(files) ? files : [];
  const completed = new Array(items.length);
  const fractions = new Array(items.length).fill(0);
  const total = items.length;
  const workerCount = Math.max(1, Math.min(8, Math.floor(Number(concurrency) || 4), total || 1));
  const active = new Set();
  const activeFiles = new Map();
  let nextIndex = 0;
  let completedCount = 0;
  let lastReportedAt = 0;
  let lastPercent = 0;

  const report = () => {
    const now = Date.now();
    if (now - lastReportedAt < 100 && completedCount < total) return;
    lastReportedAt = now;
    const percent = total
      ? Math.max(lastPercent, Math.min(99, Math.floor(((completedCount + fractions.reduce((sum, fraction) => sum + fraction, 0)) / total) * 100)))
      : 100;
    lastPercent = percent;
    onProgress({
      completed: completedCount,
      total,
      active: active.size,
      currentFile: activeFiles.values().next().value || '',
      percent,
    });
  };

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= total) return;
      const file = items[index];
      const sourcePath = String(file?.path || '');
      const resolved = resolveProfileImportPath(destinationRoot, sourcePath);
      if (!resolved) {
        completed[index] = { file, relative: sourcePath, error: 'Skipped unsafe or empty archive path.' };
        completedCount += 1;
        report();
        continue;
      }

      active.add(index);
      activeFiles.set(index, resolved.relative);
      report();
      try {
        await downloadFile(file, resolved.destination, progress => {
          const loaded = Math.max(0, Number(progress?.loaded) || 0);
          const size = Math.max(0, Number(progress?.total) || 0);
          fractions[index] = size ? Math.max(0, Math.min(0.95, loaded / size)) : 0;
          report();
        });
        fractions[index] = 0;
        completed[index] = { file, relative: resolved.relative, error: null };
      } catch (error) {
        fractions[index] = 0;
        completed[index] = {
          file,
          relative: resolved.relative,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        active.delete(index);
        activeFiles.delete(index);
        completedCount += 1;
        report();
      }
    }
  });

  await Promise.all(workers);
  report();
  return completed;
}

module.exports = { resolveProfileImportPath, runProfileImportDownloads };
