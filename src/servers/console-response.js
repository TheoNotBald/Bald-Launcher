'use strict';

const fs = require('node:fs');

async function waitForLogResponse(logPath, responsePattern, {
  startOffset = 0,
  isRunning = () => true,
  timeoutMs = 20000,
  pollIntervalMs = 200,
  maxReadBytes = 1024 * 1024,
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let offset = Math.max(0, Number(startOffset) || 0);
  let recentOutput = '';

  while (Date.now() < deadline) {
    if (!isRunning()) throw new Error('The server exited before acknowledging the console command.');
    try {
      const size = fs.statSync(logPath).size;
      if (size < offset) {
        offset = 0;
        recentOutput = '';
      }
      const readStart = Math.max(offset, size - maxReadBytes);
      const bytesToRead = size - readStart;
      if (bytesToRead > 0) {
        const descriptor = fs.openSync(logPath, 'r');
        try {
          const buffer = Buffer.alloc(bytesToRead);
          const bytesRead = fs.readSync(descriptor, buffer, 0, bytesToRead, readStart);
          recentOutput = `${recentOutput}${buffer.subarray(0, bytesRead).toString('utf8')}`.slice(-maxReadBytes);
          offset = size;
        } finally {
          fs.closeSync(descriptor);
        }
        responsePattern.lastIndex = 0;
        if (responsePattern.test(recentOutput)) return true;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error('The server did not acknowledge the console command before the timeout.');
}

module.exports = { waitForLogResponse };
