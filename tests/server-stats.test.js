const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ServerStats = require('../src/servers/server-stats');

const htmlPath = path.join(__dirname, '..', 'bald_launcher_v7.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function encodeVarInt(value) {
  let remaining = value;
  const output = [];
  do {
    let part = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) part |= 0x80;
    output.push(part);
  } while (remaining);
  return Buffer.from(output);
}

function statusResponse(status) {
  const json = Buffer.from(JSON.stringify(status), 'utf8');
  const packet = Buffer.concat([Buffer.from([0]), encodeVarInt(json.length), json]);
  return Buffer.concat([encodeVarInt(packet.length), packet]);
}

const supportedVersions = [...html.matchAll(/const FALLBACK_VERSIONS = \[([^\]]+)\]/g)]
  .flatMap(match => [...match[1].matchAll(/'([^']+)'/g)].map(version => version[1]));
const supportedTypes = [...html.matchAll(/<option value="([^"]+)">(?:Paper|Purpur|Folia|Forge|NeoForge|Spigot|Bukkit|Velocity|Waterfall|BungeeCord|Vanilla|Fabric|Quilt)<\/option>/g)]
  .map(match => match[1]);

test('all selectable server types and fallback Minecraft versions have explicit TPS behavior', () => {
  assert.deepEqual(supportedTypes, ServerStats.SERVER_TYPES);
  assert.ok(supportedVersions.length > 0);
  for (const serverType of supportedTypes) {
    for (const mcVersion of supportedVersions) {
      const config = ServerStats.getTpsProviderConfig({ serverType, mcVersion });
      assert.ok(['built-in', 'proxy', 'missing-mod'].includes(config.kind), `${serverType} ${mcVersion}`);
      assert.equal(config.kind === 'proxy' || config.kind === 'missing-mod' ? config.command : typeof config.command === 'string', config.kind === 'proxy' || config.kind === 'missing-mod' ? null : true);
    }
  }
});

test('TPS provider selection respects provider availability and implementation-specific commands', () => {
  for (const serverType of ['paper', 'purpur', 'folia']) {
    assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType, mcVersion: '1.20.1' }), { kind: 'missing-mod', command: null });
    assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType, mcVersion: '1.21.1' }), { kind: 'built-in', command: 'spark tps' });
    assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType, mcVersion: '26.2' }), { kind: 'built-in', command: 'spark tps' });
  }
  assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType: 'vanilla', mcVersion: '1.21.1', installed: [{ slug: 'spark' }] }), { kind: 'mod', command: 'spark tps' });
  assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType: 'fabric', mcVersion: '1.20.1', installed: [{ slug: 'fabric-tps' }] }), { kind: 'mod', command: 'tps' });
  assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType: 'velocity', mcVersion: '1.21.1' }), { kind: 'proxy', command: null });
  assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType: 'velocity', mcVersion: '1.21.1', installed: [{ slug: 'spark' }] }), { kind: 'mod', command: 'sparkv tps' });
  assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType: 'waterfall', mcVersion: '1.20.1', hasSparkFile: true }), { kind: 'mod', command: 'sparkb tps' });
  assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType: 'forge', mcVersion: '1.12.2' }), { kind: 'built-in', command: 'forge tps' });
  assert.deepEqual(ServerStats.getTpsProviderConfig({ serverType: 'neoforge', mcVersion: '1.21.1' }), { kind: 'built-in', command: 'neoforge tps' });
});

test('TPS and tick-duration parsers recognize Spark, Paper, Forge, and NeoForge response formats', () => {
  assert.equal(ServerStats.parseTpsOutput('TPS from last 1m, 5m, 15m: 20.0, 19.9, 19.8'), 20);
  assert.equal(ServerStats.parseTpsOutput('Mean tick time: 12.345 ms. Mean TPS: 19.876'), 19.876);
  assert.equal(ServerStats.parseTpsOutput('Mean tick time: 12.345 ms. Mean TPS: 19.876'), 19.876);
  assert.equal(ServerStats.parseMsptOutput('Tick durations from last 10s, 1m, 5m: 12.1, 12.5, 13.0'), 12.1);
  assert.equal(ServerStats.parseMsptOutput('12.1, 12.5, 13.0'), 12.1);
  assert.equal(ServerStats.parseMsptOutput('Mean tick time: 12.345 ms. Mean TPS: 19.876'), 12.345);
  assert.equal(ServerStats.parseMsptOutput('5s: 12.1/11.0/14.0/12.5; 10s: 12.5/11.0/15.0/12.0'), 12.1);
  assert.equal(ServerStats.parseTpsOutput('TPS unavailable'), null);
  assert.equal(ServerStats.parseMsptOutput('no measurements'), null);
});

test('fragmented console chunks preserve complete Spark TPS lines and CRLF boundaries', () => {
  const first = ServerStats.splitCompleteLines('', '[Spark] TPS from last 5s, 10s, 1m, 5m, 15m:');
  assert.deepEqual(first.lines, []);
  const second = ServerStats.splitCompleteLines(first.remainder, ' 20.00, 19.99, 19.98, 19.97, 19.96\r\nTick durations from last 5s, 10s: 12.');
  assert.deepEqual(second.lines, [
    '[Spark] TPS from last 5s, 10s, 1m, 5m, 15m: 20.00, 19.99, 19.98, 19.97, 19.96',
  ]);
  assert.equal(ServerStats.parseTpsOutput(second.lines[0]), 20);
  const third = ServerStats.splitCompleteLines(second.remainder, '5/11.9/13.2/12.4; 1m: 13.0/12.1/14.1/13.2\r\n');
  assert.deepEqual(third.lines, ['Tick durations from last 5s, 10s: 12.5/11.9/13.2/12.4; 1m: 13.0/12.1/14.1/13.2']);
  assert.equal(ServerStats.parseMsptOutput(third.lines[0]), 12.5);
});

test('Spark worker-pool log lines contain parseable TPS and tick-duration readings', () => {
  const sparkOutput = [
    '[23:37:32] [spark-worker-pool-1-thread-3/INFO]: [⚡] TPS from last 5s, 10s, 1m, 5m, 15m:',
    '[23:37:32] [spark-worker-pool-1-thread-3/INFO]: [⚡]  20.0, 20.0, *20.0, *20.0, *20.0',
    '[23:37:32] [spark-worker-pool-1-thread-3/INFO]: [⚡] Tick durations (min/med/95%ile/max ms) from last 10s, 1m:',
    '[23:37:32] [spark-worker-pool-1-thread-3/INFO]: [⚡]  0.2/0.4/0.8/1.0;  0.2/0.4/1.2/98.3',
  ];
  const handlerStart = main.indexOf('function normalizeServerTpsLine(');
  const handlerEnd = main.indexOf('\nfunction cloneDefaultState()', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, 'server output handler should exist');
  const output = [];
  const pollResults = [];
  const poll = {
    buffer: [],
    inFlight: true,
    kind: 'mod',
    command: 'spark tps',
    tps: null,
    mspt: null,
    awaitingTps: false,
    awaitingMspt: false,
    awaitingCpu: false,
    sawSparkResponse: false,
    commandFailed: false,
    resolve: result => pollResults.push(result),
  };
  const context = {
    Date,
    ServerStats,
    emitServerConsole: (...entry) => output.push(entry),
    serverOutputLineBuffers: new Map(),
    serverTpsSamples: new Map(),
    tpsPollState: new Map([['server-1', poll]]),
  };

  vm.runInNewContext(
    `${main.slice(handlerStart, handlerEnd)}\nhandleServerProcessOutput('server-1', 'info', ${JSON.stringify(`${sparkOutput.join('\n')}\n`)}, 'stdout');`,
    context,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(pollResults)), [{ tps: 20, mspt: 0.2 }]);
  assert.deepEqual(output, []);
});

test('Minecraft server status ping reads live player counts from incremental protocol responses', async () => {
  const server = net.createServer(socket => {
    socket.on('data', () => {
      const response = statusResponse({ version: { name: '1.21.1', protocol: 767 }, players: { online: 3, max: 20 } });
      socket.write(response.subarray(0, 3));
      setTimeout(() => socket.write(response.subarray(3)), 5);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    assert.deepEqual(await ServerStats.queryMinecraftStatus('127.0.0.1', address.port), { online: 3, maximum: 20 });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('unreachable and malformed server status endpoints report unavailable metrics', async () => {
  assert.equal(await ServerStats.queryMinecraftStatus('127.0.0.1', 1, 100), null);
  assert.equal(await ServerStats.queryMinecraftStatus('127.0.0.1', 65536), null);
  const server = net.createServer(socket => socket.once('data', () => socket.end(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal(await ServerStats.queryMinecraftStatus('127.0.0.1', server.address().port), null);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Stats tab wires live player queries, provider-specific TPS, scrollable charts, and explicit provider discovery', () => {
  assert.match(html, /<script src="src\/servers\/server-stats\.js"><\/script>/);
  assert.match(html, /\.server-stats-panel\.active\{overflow-y:auto/);
  assert.match(html, /Online \/ maximum players/);
  assert.match(html, /Status ping unavailable/);
  assert.match(html, /window\.confirm\(`TPS monitoring is not available/);
  assert.match(html, /Nothing will be installed unless you choose it/);
  assert.match(main, /ServerStats\.queryMinecraftStatus\('127\.0\.0\.1', server\.serverPort\)/);
  assert.match(main, /ServerStats\.getTpsProviderConfig/);
  assert.match(main, /parseServerTpsOutput\(line\)/);
  assert.match(main, /parseServerMsptOutput\(line\)/);
  assert.match(main, /state\.resolve\(\{ tps, mspt: state\.mspt \}\)/);
  assert.match(html, /const kind = result\.kind \|\| 'mod'/);
});

test('TPS and RAM charts retain and plot the full two-minute window', () => {
  assert.match(html, /const SERVER_STATS_WINDOW_MS = 2 \* 60 \* 1000/);
  assert.equal((html.match(/Last 2 min/g) || []).length, 2);
  assert.match(html, /const windowStart = now - SERVER_STATS_WINDOW_MS/);
  assert.match(html, /Number\(sample\.time\) - windowStart\) \/ SERVER_STATS_WINDOW_MS/);

  const start = html.indexOf('function drawLineChart(');
  const end = html.indexOf('\nfunction updateServerStatsCharts(', start);
  assert.ok(start >= 0 && end > start, 'chart drawing function should exist');
  const points = [];
  let paths = 0;
  let backingSize = null;
  const context = {
    Date: { now: () => 200000 },
    window: { devicePixelRatio: 2 },
    SERVER_STATS_WINDOW_MS: 120000,
    canvas: {
      width: 620,
      height: 180,
      getBoundingClientRect: () => ({ width: 620, height: 180 }),
      getContext: () => ({
        clearRect() {}, fillRect() {}, beginPath() { paths += 1; }, stroke() {}, fillText() {}, closePath() {}, fill() {}, arc() {}, setTransform() {},
        moveTo: x => { if (paths === 6) points.push(x); },
        lineTo: x => { if (paths === 6) points.push(x); },
      }),
    },
  };
  vm.runInNewContext(
    `${html.slice(start, end)}\ndrawLineChart(canvas, [
      { time: 79999, value: 1 },
      { time: 80000, value: 2 },
      { time: 140000, value: 3 },
      { time: 200000, value: 4 },
    ], '#fff', 'empty');`,
    context,
  );
  backingSize = [context.canvas.width, context.canvas.height];
  assert.deepEqual(points.slice(0, 3), [48, 328, 608]);
  assert.deepEqual(backingSize, [1240, 360]);
  assert.match(html, /devicePixelRatio/);
  assert.match(html, /height:190px/);
  assert.match(html, /Waiting for memory sample/);
});
