// 用 node --test 运行；以假的宿主加载 main.js，签名用 node:crypto 独立核对
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const SOURCE = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const API_KEY = 'KEY-1234';
const API_SECRET = 'SECRET-never-log';
const SESSION_KEY = 'SESSION-never-log';
const START = Date.UTC(2026, 10, 3, 8, 0, 0);

const nodeMd5 = (text) => crypto.createHash('md5').update(text, 'utf8').digest('hex');
const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

function createHost({ loggedIn = true, config = {}, current = null, state = null } = {}) {
  const host = {
    clock: START,
    timers: [],
    nextTimer: 1,
    storage: {
      config: { apiKey: API_KEY, apiSecret: API_SECRET, scrobble: true, nowPlaying: true, artistMode: 'first', ...config },
      ...(loggedIn ? { session: { name: 'tester', key: SESSION_KEY, apiKey: API_KEY } } : {})
    },
    listeners: {},
    actions: {},
    page: {},
    toasts: [],
    opened: [],
    logs: [],
    requests: [],
    scrobbles: [],
    nowPlaying: [],
    details: {},
    offline: false,
    authorized: false,
    scrobbleError: null,
    ignoredCode: 0,
    current,
    state: state || { playing: true, positionMs: 0, durationMs: 0 }
  };

  function respond(req) {
    if (host.offline) throw new Error('网络请求失败：timeout');
    assert.equal(req.url, 'https://ws.audioscrobbler.com/2.0/');
    assert.equal(req.method, 'POST');
    const params = Object.fromEntries(new URLSearchParams(req.body));
    const signed = Object.keys(params).filter((k) => k !== 'format' && k !== 'api_sig').sort();
    assert.equal(params.api_sig, nodeMd5(signed.map((k) => k + params[k]).join('') + API_SECRET), '签名不一致');
    assert.equal(params.api_key, API_KEY);
    host.requests.push(params);
    const json = (status, data) => ({ status, headers: {}, body: JSON.stringify(data) });
    switch (params.method) {
      case 'auth.getToken':
        return json(200, { token: 'TOKEN-1' });
      case 'auth.getSession':
        assert.equal(params.token, 'TOKEN-1');
        return host.authorized
          ? json(200, { session: { name: 'tester', key: SESSION_KEY, subscriber: 0 } })
          : json(403, { error: 14, message: 'Unauthorized Token' });
      case 'track.updateNowPlaying':
        assert.equal(params.sk, SESSION_KEY);
        host.nowPlaying.push(params);
        return json(200, { nowplaying: {} });
      case 'track.scrobble': {
        assert.equal(params.sk, SESSION_KEY);
        if (host.scrobbleError) return json(400, host.scrobbleError);
        const items = [];
        for (let i = 0; params[`artist[${i}]`] !== undefined; i++) {
          items.push({
            artist: params[`artist[${i}]`],
            track: params[`track[${i}]`],
            album: params[`album[${i}]`],
            timestamp: Number(params[`timestamp[${i}]`]),
            duration: params[`duration[${i}]`]
          });
        }
        if (host.ignoredCode) {
          return json(200, { scrobbles: { scrobble: items.map(() => ({ ignoredMessage: { code: String(host.ignoredCode) } })) } });
        }
        host.scrobbles.push(...items);
        const result = items.map(() => ({ ignoredMessage: { code: '0' } }));
        return json(200, { scrobbles: { scrobble: result.length === 1 ? result[0] : result, '@attr': { accepted: items.length, ignored: 0 } } });
      }
      default:
        throw new Error('未知接口 ' + params.method);
    }
  }

  const melodia = {
    http: { request: async (req) => respond(clone(req)) },
    storage: {
      get: async (key) => clone(host.storage[key]),
      set: async (key, value) => {
        if (value === null || value === undefined) delete host.storage[key];
        else host.storage[key] = clone(value);
      },
      remove: async (key) => { delete host.storage[key]; }
    },
    player: { current: async () => clone(host.current), state: async () => clone(host.state) },
    ui: {
      setState: async (page, patch) => { assert.equal(page, 'account'); Object.assign(host.page, clone(patch)); },
      toast: async (text) => { host.toasts.push(text); },
      openUrl: async (url) => { host.opened.push(url); }
    },
    netease: {
      call: async (method, params) => {
        assert.equal(method, 'song.detail');
        const item = host.details[params.ids[0]];
        if (!item) throw new Error('用户尚未登录');
        return [clone(item)];
      }
    },
    on: (event, handler) => { (host.listeners[event] ||= []).push(handler); },
    register: { action: (name, handler) => { host.actions[name] = handler; } }
  };

  class FakeDate extends Date {
    static now() { return host.clock; }
  }
  const log = (...args) => host.logs.push(args.join(' '));
  const context = vm.createContext({
    melodia,
    Date: FakeDate,
    console: { log, warn: log, error: log, info: log },
    setTimeout: (fn, ms) => addTimer(fn, ms, false),
    setInterval: (fn, ms) => addTimer(fn, ms, true),
    clearTimeout: (id) => { host.timers = host.timers.filter((t) => t.id !== id); },
    clearInterval: (id) => { host.timers = host.timers.filter((t) => t.id !== id); }
  });

  function addTimer(fn, ms, repeat) {
    const id = host.nextTimer++;
    host.timers.push({ id, fn, ms: Math.max(ms || 0, 1), due: host.clock + Math.max(ms || 0, 1), repeat });
    return id;
  }

  host.context = context;
  host.settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  };
  // 推进时钟并按顺序触发到期的定时器
  host.advance = async (ms) => {
    const target = host.clock + ms;
    for (;;) {
      const due = host.timers.filter((t) => t.due <= target).sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      host.clock = due.due;
      if (due.repeat) due.due += due.ms;
      else host.timers = host.timers.filter((t) => t !== due);
      due.fn();
      await host.settle();
    }
    host.clock = target;
  };
  host.emit = async (event, data) => {
    (host.listeners[event] || []).forEach((h) => h(clone(data)));
    await host.settle();
  };
  // 列表外的按钮把当前页面数据作为参数
  host.click = async (name) => host.action(name, clone(host.page));
  host.action = async (name, args = null) => {
    await host.actions[name](args);
    await host.settle();
  };
  // 播放中每秒一次 progress
  host.tick = async (seconds, { from, durationMs }) => {
    for (let i = 1; i <= seconds; i++) {
      host.clock += 1000;
      await host.emit('progress', { positionMs: from + i * 1000, durationMs });
    }
    return from + seconds * 1000;
  };
  host.load = async () => {
    vm.runInContext(SOURCE, context, { filename: 'main.js' });
    await host.settle();
    return host;
  };
  return host;
}

const songA = { id: 'a', songId: 101, title: '晴天', artist: '周杰伦', cover: '' };
const songB = { id: 'b', songId: 102, title: 'Song B', artist: 'X / Y', cover: '' };

function assertNoSecrets(host) {
  const text = host.logs.join('\n') + JSON.stringify(host.page) + host.toasts.join('\n');
  assert.ok(!text.includes(API_SECRET), '日志或页面里出现了 Shared Secret');
  assert.ok(!text.includes(SESSION_KEY), '日志或页面里出现了会话密钥');
}

test('md5 与 node:crypto 一致', async () => {
  const host = await createHost({ loggedIn: false }).load();
  const md5 = vm.runInContext('md5', host.context);
  for (const text of ['', 'a', 'The quick brown fox jumps over the lazy dog', '晴天 周杰伦', 'emoji 🎵 测试', 'x'.repeat(1000), 'y'.repeat(55), 'z'.repeat(56), 'w'.repeat(64)]) {
    assert.equal(md5(text), nodeMd5(text), text.slice(0, 20));
  }
});

test('浏览器授权：打开授权页，轮询到会话后保存', async () => {
  const host = await createHost({ loggedIn: false }).load();
  assert.equal(host.page.canLogin, true);
  await host.click('login');
  assert.equal(host.opened.length, 1);
  assert.equal(host.opened[0], `https://www.last.fm/api/auth/?api_key=${API_KEY}&token=TOKEN-1`);
  assert.equal(host.page.waiting, true);

  await host.advance(3000);
  assert.equal(host.storage.session, undefined);
  host.authorized = true;
  await host.advance(3000);
  assert.deepEqual(host.storage.session, { name: 'tester', key: SESSION_KEY, apiKey: API_KEY });
  assert.equal(host.page.loggedIn, true);
  assert.equal(host.page.waiting, false);
  const polls = host.requests.filter((r) => r.method === 'auth.getSession').length;
  await host.advance(30000);
  assert.equal(host.requests.filter((r) => r.method === 'auth.getSession').length, polls, '登录后应停止轮询');
  assertNoSecrets(host);
});

test('授权超时后停止轮询', async () => {
  const host = await createHost({ loggedIn: false }).load();
  await host.click('login');
  await host.advance(6 * 60 * 1000);
  assert.equal(host.page.waiting, false);
  assert.match(host.page.error, /超时/);
  const polls = host.requests.length;
  await host.advance(60000);
  assert.equal(host.requests.length, polls);
});

test('未填写 Key 时不能登录', async () => {
  const host = await createHost({ loggedIn: false, config: { apiKey: '', apiSecret: '' } }).load();
  await host.click('login');
  assert.equal(host.requests.length, 0);
  assert.match(host.page.error, /API Key/);
});

test('页面里填写后直接点登录：保存配置，Secret 不回填页面', async () => {
  const host = await createHost({ loggedIn: false, config: { apiKey: '', apiSecret: '' } }).load();
  assert.equal(host.page.apiKeyInput, '');
  host.page.apiKeyInput = ' ' + API_KEY + ' ';
  host.page.apiSecretInput = API_SECRET;
  await host.click('login');
  assert.equal(host.storage.config.apiKey, API_KEY);
  assert.equal(host.storage.config.apiSecret, API_SECRET);
  assert.equal(host.opened.length, 1);
  assert.equal(host.page.apiSecretInput, '');
  assert.match(host.page.secretHint, /已保存/);

  // Secret 留空再保存时保留原值
  host.page.apiSecretInput = '';
  await host.click('save');
  assert.equal(host.storage.config.apiSecret, API_SECRET);
  assertNoSecrets(host);
});

test('换 API Key 后视为未登录', async () => {
  const host = await createHost().load();
  assert.equal(host.page.loggedIn, true);
  host.page.apiKeyInput = 'OTHER-KEY';
  await host.click('save');
  assert.equal(host.page.loggedIn, false);
});

test('页面开关保存到存储', async () => {
  const host = await createHost().load();
  assert.equal(host.page.scrobble, true);
  await host.action('setScrobble', { value: false });
  await host.action('setArtistMode', { value: 'all' });
  assert.equal(host.storage.config.scrobble, false);
  assert.equal(host.storage.config.artistMode, 'all');
  await host.emit('songChanged', songB);
  await host.tick(150, { from: 0, durationMs: 200000 });
  assert.equal(host.scrobbles.length, 0);
  assert.equal(host.nowPlaying[0].artist, 'X, Y');
});

test('正在播放带专辑，播过一半后 scrobble 一次', async () => {
  const host = await createHost().load();
  host.details[101] = { songId: 101, title: '晴天', artist: '周杰伦', artists: [{ id: 1, name: '周杰伦' }], album: '叶惠美', durationMs: 269000 };
  await host.emit('songChanged', songA);
  assert.equal(host.nowPlaying.length, 1);
  assert.equal(host.nowPlaying[0].album, '叶惠美');
  assert.equal(host.nowPlaying[0].track, '晴天');

  let pos = await host.tick(134, { from: 0, durationMs: 269000 });
  assert.equal(host.scrobbles.length, 0);
  pos = await host.tick(1, { from: pos, durationMs: 269000 });
  assert.equal(host.scrobbles.length, 1);
  assert.deepEqual(host.scrobbles[0], { artist: '周杰伦', track: '晴天', album: '叶惠美', timestamp: START / 1000, duration: '269' });
  await host.tick(130, { from: pos, durationMs: 269000 });
  assert.equal(host.scrobbles.length, 1, '同一次播放只提交一次');
  assert.deepEqual(host.storage.queue, []);
  assertNoSecrets(host);
});

test('长歌满 4 分钟即计数，30 秒以内的歌不计数', async () => {
  const host = await createHost().load();
  await host.emit('songChanged', songA);
  await host.tick(239, { from: 0, durationMs: 600000 });
  assert.equal(host.scrobbles.length, 0);
  await host.tick(1, { from: 239000, durationMs: 600000 });
  assert.equal(host.scrobbles.length, 1);

  await host.emit('songChanged', songB);
  await host.tick(30, { from: 0, durationMs: 30000 });
  assert.equal(host.scrobbles.length, 1);
});

test('暂停期间不计时，恢复后接着累计', async () => {
  const host = await createHost().load();
  await host.emit('songChanged', songA);
  let pos = await host.tick(50, { from: 0, durationMs: 200000 });
  await host.emit('playStateChanged', { playing: false });
  host.clock += 10 * 60 * 1000;
  await host.emit('playStateChanged', { playing: true });
  pos = await host.tick(49, { from: pos, durationMs: 200000 });
  assert.equal(host.scrobbles.length, 0);
  await host.tick(1, { from: pos, durationMs: 200000 });
  assert.equal(host.scrobbles.length, 1);
  assert.equal(host.scrobbles[0].timestamp, START / 1000, '时间戳是开始播放的时间');
});

test('休眠导致的长间隔不计入播放时长', async () => {
  const host = await createHost().load();
  await host.emit('songChanged', songA);
  host.clock += 5 * 60 * 1000;
  await host.emit('progress', { positionMs: 1000, durationMs: 200000 });
  assert.equal(host.scrobbles.length, 0);
});

test('播到一半前跳过不计数', async () => {
  const host = await createHost().load();
  await host.emit('songChanged', songA);
  await host.tick(60, { from: 0, durationMs: 200000 });
  await host.emit('songChanged', songB);
  await host.tick(60, { from: 0, durationMs: 300000 });
  assert.equal(host.scrobbles.length, 0);
  assert.equal(host.nowPlaying.length, 2);
  assert.equal(host.nowPlaying[1].artist, 'X', '多位歌手默认只提交第一位');
});

test('单曲循环每轮各计一次', async () => {
  const host = await createHost().load();
  await host.emit('songChanged', songA);
  await host.tick(199, { from: 0, durationMs: 200000 });
  assert.equal(host.scrobbles.length, 1);
  host.clock += 1000;
  await host.emit('progress', { positionMs: 500, durationMs: 200000 });
  const secondStart = host.clock;
  await host.tick(100, { from: 500, durationMs: 200000 });
  assert.equal(host.scrobbles.length, 2);
  assert.equal(host.scrobbles[1].timestamp, Math.floor((secondStart - 500) / 1000));
  assert.equal(host.nowPlaying.length, 2, '新一轮重新发送正在播放');
});

test('手动拖回开头不算新一轮', async () => {
  const host = await createHost().load();
  await host.emit('songChanged', songA);
  await host.tick(60, { from: 0, durationMs: 200000 });
  host.clock += 1000;
  await host.emit('progress', { positionMs: 1000, durationMs: 200000 });
  await host.tick(40, { from: 1000, durationMs: 200000 });
  assert.equal(host.scrobbles.length, 1, '累计 101 秒已过半');
  assert.equal(host.nowPlaying.length, 1);
});

test('断网时先入队，恢复后补交', async () => {
  const host = await createHost().load();
  host.offline = true;
  await host.emit('songChanged', songA);
  await host.tick(100, { from: 0, durationMs: 200000 });
  assert.equal(host.scrobbles.length, 0);
  assert.equal(host.storage.queue.length, 1);
  assert.equal(host.page.queueText, '待补交 1 条');

  host.offline = false;
  await host.advance(60 * 1000);
  assert.equal(host.scrobbles.length, 1);
  assert.deepEqual(host.storage.queue, []);
  assert.equal(host.page.error, '');
});

test('重启后从存储读回待补交记录', async () => {
  const host = createHost();
  host.storage.queue = [{ artist: 'A', track: 'T', timestamp: START / 1000 - 3600 }, { bad: true }];
  await host.load();
  assert.equal(host.scrobbles.length, 1);
  assert.deepEqual(host.scrobbles[0], { artist: 'A', track: 'T', album: undefined, timestamp: START / 1000 - 3600, duration: undefined });
});

test('超过 14 天的记录直接丢弃，超过 50 条分批提交', async () => {
  const host = createHost();
  const old = { artist: 'Old', track: 'T', timestamp: START / 1000 - 15 * 24 * 3600 };
  const fresh = Array.from({ length: 120 }, (_, i) => ({ artist: 'A', track: 'T' + i, timestamp: START / 1000 - 1000 + i }));
  host.storage.queue = [old, ...fresh];
  await host.load();
  assert.equal(host.scrobbles.length, 120);
  assert.equal(host.requests.filter((r) => r.method === 'track.scrobble').length, 3);
  assert.ok(!host.scrobbles.some((s) => s.artist === 'Old'));
});

test('会话失效时清掉登录、保留队列', async () => {
  const host = await createHost().load();
  host.scrobbleError = { error: 9, message: 'Invalid session key' };
  await host.emit('songChanged', songA);
  await host.tick(100, { from: 0, durationMs: 200000 });
  assert.equal(host.storage.session, undefined);
  assert.equal(host.storage.queue.length, 1);
  assert.equal(host.page.loggedIn, false);
  assert.ok(host.toasts.some((t) => t.includes('重新登录')));
  assertNoSecrets(host);
});

test('达到每日上限的记录保留稍后再交', async () => {
  const host = await createHost().load();
  host.ignoredCode = 5;
  await host.emit('songChanged', songA);
  await host.tick(100, { from: 0, durationMs: 200000 });
  assert.equal(host.storage.queue.length, 1);
  host.ignoredCode = 0;
  await host.advance(30 * 60 * 1000);
  assert.equal(host.scrobbles.length, 0, '一小时内不再尝试');
  await host.advance(35 * 60 * 1000);
  assert.equal(host.scrobbles.length, 1);
});

test('未登录时不记录', async () => {
  const host = await createHost({ loggedIn: false }).load();
  await host.emit('songChanged', songA);
  await host.tick(150, { from: 0, durationMs: 200000 });
  assert.equal(host.requests.length, 0);
  assert.equal(host.storage.queue, undefined);
});

test('关闭记录开关后只发正在播放', async () => {
  const host = await createHost({ config: { scrobble: false } }).load();
  await host.emit('songChanged', songA);
  await host.tick(150, { from: 0, durationMs: 200000 });
  assert.equal(host.nowPlaying.length, 1);
  assert.equal(host.scrobbles.length, 0);
});

test('插件启动时接上正在播放的歌', async () => {
  const host = await createHost({ current: songA, state: { playing: true, positionMs: 30000, durationMs: 200000 } }).load();
  assert.equal(host.nowPlaying.length, 1);
  await host.tick(100, { from: 30000, durationMs: 200000 });
  assert.equal(host.scrobbles.length, 1);
  assert.equal(host.scrobbles[0].timestamp, START / 1000 - 30);
});

test('退出登录清掉会话与队列', async () => {
  const host = createHost();
  host.offline = true;
  host.storage.queue = [{ artist: 'A', track: 'T', timestamp: START / 1000 }];
  await host.load();
  await host.action('logout');
  assert.equal(host.storage.session, undefined);
  assert.deepEqual(host.storage.queue, []);
  assert.equal(host.page.canLogin, true);
});
