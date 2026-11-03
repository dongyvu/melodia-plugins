// Last.fm 记录：正在播放、scrobble 与离线补交
const API_URL = 'https://ws.audioscrobbler.com/2.0/';
const AUTH_URL = 'https://www.last.fm/api/auth/';
const API_ACCOUNT_URL = 'https://www.last.fm/api/account/create';
const PAGE = 'account';
const QUEUE_KEY = 'queue';
const SESSION_KEY = 'session';
const CONFIG_KEY = 'config';
const MAX_QUEUE = 1000;
const BATCH_SIZE = 50;
const MIN_DURATION_MS = 30 * 1000;
const MAX_REQUIRED_MS = 4 * 60 * 1000;
// progress 每秒一次；间隔过大多半是休眠或卡顿，不按播放计
const MAX_TICK_MS = 2500;
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const MIN_RETRY_MS = 60 * 1000;
const MAX_RETRY_MS = 30 * 60 * 1000;
const DAILY_LIMIT_WAIT_MS = 60 * 60 * 1000;
const AUTH_POLL_MS = 3000;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const LOOP_EDGE_MS = 5000;
const NOW_PLAYING_RESEND_MS = 60 * 1000;
const DETAIL_TIMEOUT_MS = 3000;
// 11 服务离线、16 临时错误、29 限频
const RETRY_CODES = [11, 16, 29];
// 10 Key 无效、13 签名无效、26 Key 被停用
const CONFIG_CODES = [10, 13, 26];
const CODE_INVALID_SESSION = 9;
const CODE_TOKEN_UNAUTHORIZED = 14;
const CODE_TOKEN_EXPIRED = 15;
const CODE_INVALID_TOKEN = 4;
const IGNORED_DAILY_LIMIT = 5;

// ---------- md5 ----------

function utf8Bytes(text) {
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next < 0xe000) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    }
  }
  return bytes;
}

const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];
const MD5_TABLE = MD5_SHIFTS.map(function (_, i) { return Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0; });

function hexLittleEndian(word) {
  let out = '';
  for (let i = 0; i < 4; i++) out += ((word >>> (8 * i)) & 0xff).toString(16).padStart(2, '0');
  return out;
}

function md5(text) {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 4294967296);
  for (let i = 0; i < 4; i++) bytes.push((bitLength >>> (8 * i)) & 0xff);
  for (let i = 0; i < 4; i++) bytes.push((high >>> (8 * i)) & 0xff);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  const words = new Array(16);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let j = 0; j < 16; j++) {
      const p = offset + j * 4;
      words[j] = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24);
    }
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f;
      let g;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (a + f + MD5_TABLE[i] + words[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << MD5_SHIFTS[i]) | (sum >>> (32 - MD5_SHIFTS[i])))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  return hexLittleEndian(a0) + hexLittleEndian(b0) + hexLittleEndian(c0) + hexLittleEndian(d0);
}

// ---------- Last.fm 接口 ----------

function sign(params, secret) {
  const keys = Object.keys(params).filter(function (k) { return k !== 'format' && k !== 'callback'; }).sort();
  return md5(keys.map(function (k) { return k + params[k]; }).join('') + secret);
}

function formBody(params) {
  return Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
}

// code：Last.fm 错误码；0 为网络不可用，负数为没有错误码的 HTTP 状态
function LastfmError(code, message) {
  this.code = code;
  this.message = message;
}
LastfmError.prototype = Object.create(Error.prototype);

function retryable(e) {
  return !(e instanceof LastfmError) || e.code <= 0 || RETRY_CODES.indexOf(e.code) >= 0;
}

function describe(e) {
  if (e instanceof LastfmError) return e.code > 0 ? e.message + '（错误 ' + e.code + '）' : e.message;
  return e && e.message ? String(e.message) : String(e);
}

// 一律 POST，令牌与会话密钥只出现在请求体里
async function callApi(method, params, sessionKey) {
  const all = Object.assign({}, params, { method: method, api_key: config.apiKey });
  if (sessionKey) all.sk = sessionKey;
  all.api_sig = sign(all, config.apiSecret);
  all.format = 'json';
  let response;
  try {
    response = await melodia.http.request({
      url: API_URL,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: formBody(all)
    });
  } catch (e) {
    throw new LastfmError(0, '网络不可用');
  }
  let data = null;
  try {
    data = JSON.parse(response.body);
  } catch (e) {
    data = null;
  }
  if (data && data.error) throw new LastfmError(Number(data.error) || -1, String(data.message || 'Last.fm 返回错误'));
  if (!data || response.status >= 400) throw new LastfmError(-(response.status || 1), 'Last.fm 暂时不可用（HTTP ' + response.status + '）');
  return data;
}

// ---------- 状态 ----------

let config = { apiKey: '', apiSecret: '', scrobble: true, nowPlaying: true, artistMode: 'first' };
let session = null;
let queue = [];
let play = null;
let auth = null;
let flushing = false;
let adopting = false;
let retryTimer = null;
let retryDelay = 0;
let blockedUntil = 0;
let lastError = '';
let saveChain = Promise.resolve();

function now() {
  return Date.now();
}

function configured() {
  return !!(config.apiKey && config.apiSecret);
}

// 会话绑定申请它的 API Key，换 Key 后视为未登录
function activeSession() {
  return session && configured() && session.apiKey === config.apiKey ? session : null;
}

function normalizeConfig(values) {
  const v = values || {};
  return {
    apiKey: typeof v.apiKey === 'string' ? v.apiKey.trim() : '',
    apiSecret: typeof v.apiSecret === 'string' ? v.apiSecret.trim() : '',
    scrobble: v.scrobble !== false,
    nowPlaying: v.nowPlaying !== false,
    artistMode: v.artistMode === 'all' ? 'all' : 'first'
  };
}

async function saveConfig(patch) {
  const previousKey = config.apiKey;
  config = normalizeConfig(Object.assign({}, config, patch));
  await melodia.storage.set(CONFIG_KEY, config);
  if (previousKey !== config.apiKey) cancelAuth();
  if (blockedUntil === Infinity) blockedUntil = 0;
  if (lastError.indexOf('API Key') === 0) lastError = '';
}

// 输入框与开关只在启动和保存后回填，避免定时刷新覆盖正在输入的内容；Secret 从不回填
function syncForm() {
  melodia.ui.setState(PAGE, {
    apiKeyInput: config.apiKey,
    apiSecretInput: '',
    secretHint: config.apiSecret ? 'Shared Secret 已保存，留空表示不修改' : '',
    scrobble: config.scrobble,
    nowPlaying: config.nowPlaying,
    artistMode: config.artistMode
  }).catch(function () {});
}

// 按钮传来的页面数据里取出输入框内容；Secret 留空时保留原值
async function saveForm(form) {
  const patch = {};
  if (form && typeof form.apiKeyInput === 'string') patch.apiKey = form.apiKeyInput;
  if (form && typeof form.apiSecretInput === 'string' && form.apiSecretInput.trim()) patch.apiSecret = form.apiSecretInput;
  await saveConfig(patch);
  syncForm();
  refreshPage();
}

function validSession(value) {
  return !!(value && typeof value.key === 'string' && value.key && typeof value.apiKey === 'string');
}

function validEntry(e) {
  return !!(e && typeof e.artist === 'string' && e.artist && typeof e.track === 'string' && e.track && typeof e.timestamp === 'number');
}

function saveQueue() {
  saveChain = saveChain.then(function () { return melodia.storage.set(QUEUE_KEY, queue.slice()); }).catch(function (e) {
    console.warn('保存待补交记录失败: ' + describe(e));
  });
  return saveChain;
}

function refreshPage() {
  const active = activeSession();
  let status;
  if (auth) status = '已在浏览器打开授权页，授权后回到这里稍等片刻';
  else if (active) status = '已登录：' + active.name;
  else if (configured()) status = '未登录';
  else status = '请先填写 API Key 和 Shared Secret';
  melodia.ui.setState(PAGE, {
    status: status,
    error: lastError,
    loggedIn: !!active,
    waiting: !!auth,
    canLogin: !active && !auth,
    pending: !!active && queue.length > 0,
    queueText: queue.length ? '待补交 ' + queue.length + ' 条' : '没有待补交的记录',
    hint: configured() ? '' : '还没有 API 账号时，点「申请 API 账号」在 Last.fm 创建，回调地址可以留空'
  }).catch(function () {});
}

// ---------- 播放计数 ----------

function splitArtists(text) {
  return String(text || '').split(/\s*\/\s*/).filter(function (s) { return s; });
}

function displayArtist(names, joined) {
  if (!names.length) return String(joined || '').trim();
  return config.artistMode === 'all' ? names.join(', ') : names[0];
}

function startPlay(song, positionMs, playing) {
  const time = now();
  const current = {
    id: song.id,
    songId: Number(song.songId) || 0,
    title: String(song.title || '').trim(),
    artists: splitArtists(song.artist),
    rawArtist: String(song.artist || ''),
    album: '',
    durationMs: 0,
    startedAt: Math.floor((time - (positionMs || 0)) / 1000),
    playedMs: 0,
    lastTick: playing === false ? null : time,
    lastPos: positionMs || 0,
    queued: false,
    nowPlayingAt: 0,
    song: song
  };
  play = current;
  lookupDetail(current).then(function () {
    if (play === current) sendNowPlaying(current);
  });
  return current;
}

// 网易歌曲补专辑、时长与歌手列表；没登录或失败时不带专辑
async function lookupDetail(current) {
  if (!current.songId) return;
  let timer = null;
  try {
    const detail = await Promise.race([
      melodia.netease.call('song.detail', { ids: [current.songId] }),
      new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, DETAIL_TIMEOUT_MS); })
    ]);
    const item = Array.isArray(detail) ? detail[0] : null;
    if (!item) return;
    if (item.album) current.album = String(item.album);
    if (!current.durationMs && item.durationMs > 0) current.durationMs = Number(item.durationMs);
    if (Array.isArray(item.artists) && item.artists.length) {
      current.artists = item.artists.map(function (a) { return String(a && a.name || '').trim(); }).filter(function (s) { return s; });
    }
  } catch (e) {
    // 未登录网易或接口失败时照常记录，只是没有专辑
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function trackInfo(p) {
  return { artist: displayArtist(p.artists, p.rawArtist), track: p.title, album: p.album };
}

function reached(p) {
  if (p.durationMs > 0 && p.durationMs <= MIN_DURATION_MS) return false;
  const need = p.durationMs > 0 ? Math.min(p.durationMs / 2, MAX_REQUIRED_MS) : MAX_REQUIRED_MS;
  return p.playedMs >= need;
}

function checkThreshold(p) {
  if (p.queued || !reached(p)) return;
  p.queued = true;
  if (!config.scrobble || !activeSession()) return;
  const info = trackInfo(p);
  if (!info.artist || !info.track) return;
  const entry = { artist: info.artist, track: info.track, timestamp: p.startedAt };
  if (info.album) entry.album = info.album;
  if (p.durationMs > 0) entry.duration = Math.round(p.durationMs / 1000);
  queue.push(entry);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  saveQueue();
  refreshPage();
  flush(false);
}

function sendNowPlaying(p) {
  const active = activeSession();
  if (!config.nowPlaying || !active) return;
  const info = trackInfo(p);
  if (!info.artist || !info.track) return;
  const params = { artist: info.artist, track: info.track };
  if (info.album) params.album = info.album;
  if (p.durationMs > 0) params.duration = String(Math.round(p.durationMs / 1000));
  p.nowPlayingAt = now();
  callApi('track.updateNowPlaying', params, active.key).catch(function (e) {
    if (e.code === CODE_INVALID_SESSION) invalidateSession();
  });
}

async function adoptCurrent() {
  if (adopting || play) return;
  adopting = true;
  try {
    const song = await melodia.player.current();
    const state = await melodia.player.state();
    if (song && !play) {
      const current = startPlay(song, state ? state.positionMs : 0, state ? state.playing : true);
      if (state && state.durationMs > 0) current.durationMs = state.durationMs;
    }
  } catch (e) {
    console.warn('读取当前播放失败: ' + describe(e));
  } finally {
    adopting = false;
  }
}

function onSongChanged(song) {
  play = null;
  if (song) startPlay(song, 0, true);
}

function onPlayStateChanged(data) {
  if (!play) return;
  if (data && data.playing) {
    play.lastTick = now();
    if (now() - play.nowPlayingAt > NOW_PLAYING_RESEND_MS) sendNowPlaying(play);
  } else {
    play.lastTick = null;
  }
}

function onProgress(data) {
  if (!data) return;
  if (!play) {
    adoptCurrent();
    return;
  }
  const position = Number(data.positionMs) || 0;
  if (data.durationMs > 0) play.durationMs = Number(data.durationMs);
  // 单曲循环不触发 songChanged：上一轮播到结尾附近、进度又回到开头时算新一轮
  if (play.durationMs > 0 && play.lastPos >= play.durationMs - LOOP_EDGE_MS && position < LOOP_EDGE_MS && position < play.lastPos) {
    const previous = play;
    const next = startPlay(previous.song, position, true);
    next.durationMs = previous.durationMs;
    next.album = previous.album;
    next.artists = previous.artists;
    return;
  }
  const time = now();
  if (play.lastTick !== null) play.playedMs += Math.min(Math.max(time - play.lastTick, 0), MAX_TICK_MS);
  play.lastTick = time;
  play.lastPos = position;
  checkThreshold(play);
}

// ---------- 补交 ----------

function scheduleRetry() {
  retryDelay = Math.min(Math.max(retryDelay * 2, MIN_RETRY_MS), MAX_RETRY_MS);
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = setTimeout(function () {
    retryTimer = null;
    flush(false);
  }, retryDelay);
}

function removeEntries(entries) {
  queue = queue.filter(function (e) { return entries.indexOf(e) < 0; });
}

function invalidateSession() {
  if (!session) return;
  session = null;
  melodia.storage.remove(SESSION_KEY).catch(function () {});
  lastError = 'Last.fm 登录已失效，请重新登录';
  melodia.ui.toast(lastError).catch(function () {});
  refreshPage();
}

async function flush(manual) {
  const active = activeSession();
  if (flushing || !active || !queue.length) return;
  if (!manual && now() < blockedUntil) return;
  flushing = true;
  let batch = [];
  try {
    while (queue.length) {
      const expired = queue.filter(function (e) { return now() - e.timestamp * 1000 > MAX_AGE_MS; });
      if (expired.length) removeEntries(expired);
      batch = queue.slice(0, BATCH_SIZE);
      if (!batch.length) break;
      const params = {};
      batch.forEach(function (e, i) {
        params['artist[' + i + ']'] = e.artist;
        params['track[' + i + ']'] = e.track;
        params['timestamp[' + i + ']'] = String(e.timestamp);
        if (e.album) params['album[' + i + ']'] = e.album;
        if (e.duration) params['duration[' + i + ']'] = String(e.duration);
      });
      const data = await callApi('track.scrobble', params, active.key);
      const raw = data.scrobbles && data.scrobbles.scrobble;
      const results = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const limited = batch.filter(function (e, i) {
        const ignored = results[i] && results[i].ignoredMessage;
        return !!ignored && Number(ignored.code) === IGNORED_DAILY_LIMIT;
      });
      removeEntries(batch.filter(function (e) { return limited.indexOf(e) < 0; }));
      saveQueue();
      retryDelay = 0;
      blockedUntil = 0;
      lastError = '';
      if (limited.length) {
        blockedUntil = now() + DAILY_LIMIT_WAIT_MS;
        lastError = '已达到 Last.fm 每日上限，稍后自动补交';
        break;
      }
    }
  } catch (e) {
    if (e.code === CODE_INVALID_SESSION) {
      invalidateSession();
    } else if (CONFIG_CODES.indexOf(e.code) >= 0) {
      // 等用户改设置后再试
      blockedUntil = Infinity;
      lastError = 'API Key 或 Shared Secret 无效：' + describe(e);
    } else if (retryable(e)) {
      lastError = '补交失败，稍后重试：' + describe(e);
      scheduleRetry();
    } else {
      // 整批被拒（如参数错误）时丢弃这一批，避免队列卡死
      removeEntries(batch);
      saveQueue();
      lastError = '有 ' + batch.length + ' 条记录被 Last.fm 拒绝：' + describe(e);
    }
  } finally {
    flushing = false;
    refreshPage();
  }
}

// ---------- 授权 ----------

function cancelAuth() {
  if (auth && auth.timer !== null) clearInterval(auth.timer);
  auth = null;
}

async function login() {
  if (!configured()) {
    lastError = '请先填写 API Key 和 Shared Secret';
    refreshPage();
    return;
  }
  cancelAuth();
  const attempt = { token: null, startedAt: now(), timer: null, checking: false };
  auth = attempt;
  lastError = '';
  refreshPage();
  try {
    const data = await callApi('auth.getToken', {}, null);
    if (auth !== attempt) return;
    if (!data.token) throw new LastfmError(-1, 'Last.fm 没有返回授权令牌');
    attempt.token = String(data.token);
    await melodia.ui.openUrl(AUTH_URL + '?api_key=' + encodeURIComponent(config.apiKey) + '&token=' + encodeURIComponent(attempt.token));
    if (auth !== attempt) return;
    attempt.startedAt = now();
    attempt.timer = setInterval(function () { checkAuth(attempt); }, AUTH_POLL_MS);
  } catch (e) {
    if (auth !== attempt) return;
    cancelAuth();
    lastError = '登录失败：' + describe(e);
    refreshPage();
  }
}

async function checkAuth(attempt) {
  if (!attempt || attempt !== auth || !attempt.token || attempt.checking) return;
  if (now() - attempt.startedAt > AUTH_TIMEOUT_MS) {
    cancelAuth();
    lastError = '授权超时，请重新登录';
    refreshPage();
    return;
  }
  attempt.checking = true;
  try {
    const data = await callApi('auth.getSession', { token: attempt.token }, null);
    if (auth !== attempt) return;
    const info = data.session || {};
    if (!info.key) throw new LastfmError(-1, 'Last.fm 没有返回会话');
    session = { name: String(info.name || ''), key: String(info.key), apiKey: config.apiKey };
    await melodia.storage.set(SESSION_KEY, session);
    cancelAuth();
    lastError = '';
    blockedUntil = 0;
    melodia.ui.toast('已登录 Last.fm：' + session.name).catch(function () {});
    if (play) sendNowPlaying(play);
    flush(true);
  } catch (e) {
    if (auth !== attempt) return;
    if (e.code === CODE_TOKEN_UNAUTHORIZED || retryable(e)) {
      // 用户还没在网页上点允许，继续等
    } else if (e.code === CODE_TOKEN_EXPIRED || e.code === CODE_INVALID_TOKEN) {
      cancelAuth();
      lastError = '授权已过期，请重新登录';
    } else {
      cancelAuth();
      lastError = '登录失败：' + describe(e);
    }
  } finally {
    attempt.checking = false;
    refreshPage();
  }
}

async function logout() {
  cancelAuth();
  session = null;
  // 待补交的记录属于原账号，退出时一并清掉
  queue = [];
  lastError = '';
  await melodia.storage.remove(SESSION_KEY);
  await saveQueue();
  refreshPage();
}

// ---------- 入口 ----------

const ready = (async function () {
  try {
    config = normalizeConfig(await melodia.storage.get(CONFIG_KEY));
    const saved = await melodia.storage.get(SESSION_KEY);
    session = validSession(saved) ? saved : null;
    const savedQueue = await melodia.storage.get(QUEUE_KEY);
    queue = Array.isArray(savedQueue) ? savedQueue.filter(validEntry) : [];
  } catch (e) {
    console.warn('初始化失败: ' + describe(e));
  }
  syncForm();
  refreshPage();
  setInterval(function () { flush(false); }, FLUSH_INTERVAL_MS);
  await adoptCurrent();
  flush(false);
})();

function whenReady(handler) {
  return function (data) {
    ready.then(function () { handler(data); }).catch(function (e) { console.warn('处理事件出错: ' + describe(e)); });
  };
}

melodia.on('songChanged', whenReady(onSongChanged));
melodia.on('playStateChanged', whenReady(onPlayStateChanged));
melodia.on('progress', whenReady(onProgress));

// 动作要在 5 秒内返回，耗时的登录与补交不等待
melodia.register.action('login', function (form) {
  ready.then(function () { return saveForm(form); }).then(login).catch(function (e) {
    lastError = '保存失败：' + describe(e);
    refreshPage();
  });
});
melodia.register.action('save', function (form) {
  return ready.then(function () { return saveForm(form); }).then(function () { flush(false); });
});
melodia.register.action('setScrobble', function (args) { return ready.then(function () { return saveConfig({ scrobble: !!(args && args.value) }); }); });
melodia.register.action('setNowPlaying', function (args) { return ready.then(function () { return saveConfig({ nowPlaying: !!(args && args.value) }); }); });
melodia.register.action('setArtistMode', function (args) { return ready.then(function () { return saveConfig({ artistMode: args && args.value }); }); });
melodia.register.action('checkAuth', function () { if (auth) checkAuth(auth); });
melodia.register.action('cancelLogin', function () { cancelAuth(); refreshPage(); });
melodia.register.action('logout', function () { return logout(); });
melodia.register.action('flush', function () {
  retryDelay = 0;
  ready.then(function () { flush(true); });
});
melodia.register.action('openApiPage', function () {
  melodia.ui.openUrl(API_ACCOUNT_URL).catch(function () {});
});
melodia.register.action('open:' + PAGE, function () { refreshPage(); });
