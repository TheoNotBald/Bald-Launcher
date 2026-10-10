const fs = require('fs');
const path = require('path');

function countNewlinesBefore(filePath, bytePosition) {
  const fd = fs.openSync(filePath, 'r');
  let count = 0;
  try {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    for (let position = 0; position < bytePosition;) {
      const length = Math.min(chunk.length, bytePosition - position);
      const bytesRead = fs.readSync(fd, chunk, 0, length, position);
      if (!bytesRead) break;
      for (let index = 0; index < bytesRead; index += 1) {
        if (chunk[index] === 0x0a) count += 1;
      }
      position += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }
  return count;
}

function readCrashEvidenceAtOffset(filePath, byteOffset, expectedLine = '') {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) throw new Error('Crash evidence is not a file.');
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset > stats.size) {
    throw new Error('The selected log location is no longer available.');
  }
  const previewStart = Math.max(0, byteOffset - 4096);
  const previewEnd = Math.min(stats.size, byteOffset + 4096);
  const fd = fs.openSync(filePath, 'r');
  let buffer;
  try {
    buffer = Buffer.alloc(previewEnd - previewStart);
    fs.readSync(fd, buffer, 0, buffer.length, previewStart);
  } finally {
    fs.closeSync(fd);
  }

  let lines = buffer.toString('utf8').split(/\r?\n/);
  const lineBreaksBeforePreview = countNewlinesBefore(filePath, previewStart);
  const lineBreaksBeforeTarget = countNewlinesBefore(filePath, byteOffset);
  let firstLineNumber = lineBreaksBeforePreview + 1;
  let targetIndex = lineBreaksBeforeTarget - firstLineNumber + 1;
  if (previewStart > 0 && buffer[0] !== 0x0a) {
    lines = lines.slice(1);
    firstLineNumber += 1;
    targetIndex -= 1;
  }
  targetIndex = Math.max(0, Math.min(lines.length - 1, targetIndex));
  if (expectedLine && !lines[targetIndex]?.trim().startsWith(String(expectedLine).trim())) {
    throw new Error('This log has changed since the analysis. Run the analysis again to refresh the evidence location.');
  }
  return {
    fileName: path.basename(filePath),
    lineNumber: lineBreaksBeforeTarget + 1,
    lines: lines.map((text, index) => ({
      lineNumber: firstLineNumber + index,
      text: text.slice(0, 2000),
      target: index === targetIndex,
    })),
  };
}

module.exports = { readCrashEvidenceAtOffset };
