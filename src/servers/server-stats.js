'use strict';

(function exposeServerStats(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ServerStats = api;
}(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const MAX_STATUS_PACKET_BYTES = 1024 * 1024;
  const SERVER_TYPES = [
    'paper', 'purpur', 'folia', 'forge', 'neoforge', 'spigot', 'bukkit',
    'velocity', 'waterfall', 'bungeecord', 'vanilla', 'fabric', 'quilt',
  ];

  function stripAnsi(value) {
    return String(value || '').replace(/[\u001b\u009b]\[[0-?]*[ -\/]*[@-~]/g, '');
  }

  function splitCompleteLines(previous, chunk) {
    const text = `${String(previous || '')}${String(chunk || '')}`;
    const parts = text.split('\n');
    const remainder = parts.pop() || '';
    return {
      lines: parts.map(line => line.endsWith('\r') ? line.slice(0, -1) : line),
      remainder,
    };
  }

  function normalizeServerType(value) {
    return String(value || '').trim().toLowerCase();
  }

  function hasSparkInstalled(installed) {
    return installed.some(item => {
      const identity = `${item?.id || ''} ${item?.slug || ''} ${item?.name || ''}`.toLowerCase();
      return /\bspark(?:\b|[-_.])/.test(identity);
    });
  }

  function hasFabricTpsInstalled(installed) {
    return installed.some(item => {
      const identity = `${item?.id || ''} ${item?.slug || ''} ${item?.name || ''}`.toLowerCase();
      return /\bfabric[-_ ]tps\b/.test(identity);
    });
  }

  function isPaperSparkBundled(version) {
    const parts = String(version || '').split('.').map(Number);
    return parts[0] > 1 || (parts[0] === 1 && parts[1] >= 21);
  }

  function getTpsProviderConfig({ serverType, mcVersion, installed = [], hasSparkFile = false } = {}) {
    const type = normalizeServerType(serverType);
    const sparkInstalled = hasSparkFile || hasSparkInstalled(installed);
    const isProxy = ['velocity', 'waterfall', 'bungeecord'].includes(type);

    if (sparkInstalled) {
      const command = type === 'velocity'
        ? 'sparkv tps'
        : ['waterfall', 'bungeecord'].includes(type)
          ? 'sparkb tps'
          : 'spark tps';
      return { kind: 'mod', command };
    }
    if (isProxy) return { kind: 'proxy', command: null };

    if (['paper', 'purpur', 'folia'].includes(type) && isPaperSparkBundled(mcVersion)) {
      return { kind: 'built-in', command: 'spark tps' };
    }
    if (type === 'forge') return { kind: 'built-in', command: 'forge tps' };
    if (type === 'neoforge') return { kind: 'built-in', command: 'neoforge tps' };
    if (hasFabricTpsInstalled(installed)) return { kind: 'mod', command: 'tps' };
    return { kind: 'missing-mod', command: null };
  }

  function parseTpsOutput(value) {
    const text = stripAnsi(value);
    const match = text.match(/\bTPS\b[\s\S]*?:\s*\*?([0-9]+(?:\.[0-9]+)?)/i)
      || text.match(/\bTPS\b\s*[:=]?\s*\*?([0-9]+(?:\.[0-9]+)?)/i);
    if (!match) return null;
    const tps = Number(match[1]);
    return Number.isFinite(tps) && tps >= 0 ? tps : null;
  }

  function parseMsptOutput(value) {
    const text = stripAnsi(value);
    const direct = text.match(/\b(?:mean\s+tick\s+time|mspt|tick durations?)\b[^:\n]*:\s*([0-9]+(?:\.[0-9]+)?)(?:\s*ms)?/i);
    if (direct) return Number(direct[1]);

    const rows = text.match(/(?:^|;\s*)(?:\d+(?:\.\d+)?\s*(?:s|m)\s*:\s*)?([0-9]+(?:\.[0-9]+)?)\s*(?:ms)?(?=\s*(?:\/|,|;|$))/im);
    if (!rows) return null;
    const mspt = Number(rows[1]);
    return Number.isFinite(mspt) && mspt >= 0 ? mspt : null;
  }

  function encodeVarInt(value) {
    let remaining = value >>> 0;
    const bytes = [];
    do {
      let part = remaining & 0x7f;
      remaining >>>= 7;
      if (remaining !== 0) part |= 0x80;
      bytes.push(part);
    } while (remaining !== 0);
    return Buffer.from(bytes);
  }

  function encodeString(value) {
    const text = Buffer.from(String(value), 'utf8');
    return Buffer.concat([encodeVarInt(text.length), text]);
  }

  function createFrame(packet) {
    return Buffer.concat([encodeVarInt(packet.length), packet]);
  }

  function createStatusRequest(host, port) {
    const portBytes = Buffer.alloc(2);
    portBytes.writeUInt16BE(port);
    const handshake = Buffer.concat([
      encodeVarInt(0),
      encodeVarInt(-1),
      encodeString(host),
      portBytes,
      encodeVarInt(1),
    ]);
    return Buffer.concat([createFrame(handshake), createFrame(encodeVarInt(0))]);
  }

  function readVarInt(buffer, offset = 0) {
    let value = 0;
    for (let index = 0; index < 5; index += 1) {
      const position = offset + index;
      if (position >= buffer.length) return null;
      const byte = buffer[position];
      value |= (byte & 0x7f) << (index * 7);
      if ((byte & 0x80) === 0) return { value: value >>> 0, size: index + 1 };
    }
    throw new Error('Invalid Minecraft status packet VarInt.');
  }

  function parseStatusResponse(buffer) {
    const frameLength = readVarInt(buffer);
    if (!frameLength) return null;
    if (frameLength.value > MAX_STATUS_PACKET_BYTES) throw new Error('Minecraft status response is too large.');
    const frameStart = frameLength.size;
    const frameEnd = frameStart + frameLength.value;
    if (buffer.length < frameEnd) return null;

    const packetId = readVarInt(buffer, frameStart);
    if (!packetId || packetId.value !== 0) throw new Error('Unexpected Minecraft status response packet.');
    const stringLength = readVarInt(buffer, frameStart + packetId.size);
    if (!stringLength || stringLength.value > MAX_STATUS_PACKET_BYTES) throw new Error('Invalid Minecraft status JSON length.');
    const stringStart = frameStart + packetId.size + stringLength.size;
    const stringEnd = stringStart + stringLength.value;
    if (stringEnd > frameEnd) throw new Error('Truncated Minecraft status JSON.');

    const status = JSON.parse(buffer.toString('utf8', stringStart, stringEnd));
    const online = Number(status?.players?.online);
    const maximum = Number(status?.players?.max);
    return {
      online: Number.isInteger(online) && online >= 0 ? online : null,
      maximum: Number.isInteger(maximum) && maximum >= 0 ? maximum : null,
    };
  }

  function queryMinecraftStatus(host, port, timeoutMs = 1200) {
    return new Promise(resolve => {
      let net;
      try {
        net = require('net');
      } catch {
        resolve(null);
        return;
      }
      if (!host || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
        resolve(null);
        return;
      }

      let socket;
      try {
        socket = net.createConnection({ host, port: Number(port) });
      } catch {
        resolve(null);
        return;
      }
      let buffer = Buffer.alloc(0);
      let settled = false;
      const finish = result => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => socket.write(createStatusRequest(host, Number(port))));
      socket.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        try {
          const status = parseStatusResponse(buffer);
          if (status) finish(status);
          else if (buffer.length > MAX_STATUS_PACKET_BYTES + 5) finish(null);
        } catch {
          finish(null);
        }
      });
      socket.once('timeout', () => finish(null));
      socket.once('error', () => finish(null));
      socket.once('close', () => finish(null));
    });
  }

  return {
    SERVER_TYPES,
    splitCompleteLines,
    getTpsProviderConfig,
    isPaperSparkBundled,
    parseTpsOutput,
    parseMsptOutput,
    createStatusRequest,
    parseStatusResponse,
    queryMinecraftStatus,
  };
}));
