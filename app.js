'use strict';
/*
 * OKAI Tuning - Web Bluetooth. Implements the BLE protocol proven from com.yele.app.bleoverseascontrol
 * (OKAI / Yele "BLE Overseas Control"), BLE stack = universal_ble (generic GATT bridge), engine in Dart.
 * Proven (app_side, code-verified): GATT service 0x2C00, write char 0x2C01, notify/report char 0x2C03
 * (all 25 dial-AT scooters share this triple); the AT-over-BLE transport - plaintext ASCII, no crypto,
 * no MAC, no replay protection: frame = "AT+" + 5-char opcode + "=" + fields(,) + "," + 4-hex seq + "$\r\n"
 * (DefaultPacker.packAT), seq = plain incrementing 16-bit counter (framing, not a nonce). TX opcodes
 * OKECP (drive mode/gear) OKSCM (lock/unlock) OKSCT (power) OKXWM (cmd mode normal0/test2, gated by the
 * OKAI_CAR service password) OKNAM (set name) OKURD (OTA chunk) OKPWD (password check). Auth = command
 * password "OKAIYLBT" placed in the payload; service password "OKAI_CAR" gates OKXWM. No handshake: any
 * client that knows the frame can read + write.
 * Device_side UNKNOWN (needs on-device/HCI test, gated here, recorded in README/deviceUnknowns): the exact
 * positional field layout + value mapping of each command (e.g. which OKSCM value locks vs unlocks, the
 * OKECP gear/speed numbers), the telemetry byte offsets inside each RESP frame (the app proves which opcode
 * carries battery/mileage/etc but not the field positions), and whether firmware forces bonding/encryption.
 * So this page sends only real proven opcodes in the real proven frame with the real proven passwords, shows
 * every RESP verbatim, and never fakes a decoded number. Risky writes are confirm-boxed; an echo only means
 * "accepted" - only live telemetry proves effect.
 */

// Pre-commit cache-buster auto-bumps BUILD and every ?v= on any web-asset change.
const BUILD = 'v6';

// =========================================================================================
//  VERIFIED PROTOCOL CORE (code-proven from com.yele.app.bleoverseascontrol; self-test at load)
// =========================================================================================
// --------------------------- UUIDs (ea10_ble_impl.dart; Web Bluetooth wants lowercase) ---------------------------
const U = {
  MAIN: '00002c00-0000-1000-8000-00805f9b34fb',    // GATT service (BleConnection serviceUuid)
  WRITE: '00002c01-0000-1000-8000-00805f9b34fb',   // write characteristic (BleProtocol writeUuid)
  NOTIFY: '00002c03-0000-1000-8000-00805f9b34fb'   // notify/report characteristic (BleProtocol reportUuid)
};
// advertising / scan-filter service UUIDs (equipment_manager.dart EquipmentMetaData)
const ADV_SERVICES = ['669a0c20-0008-a7ba-e311-0685c0f7978a', '258eafa5-e914-47da-95ca-c5ab0dc85b11'];
const CANDIDATE_SERVICES = [U.MAIN, ...ADV_SERVICES];   // kept as a list so the connect probe stays fleet-shaped

// Auth (proven, all 25 dial models): command password in the payload; service password gates OKXWM.
const CMD_PWD = 'OKAIYLBT';   // command_pwd.dart, libapp_strings.txt:29994
const SVC_PWD = 'OKAI_CAR';   // command_mode.dart (gates OKXWM normal(0)/test(2))

// 7 proven TX opcodes (ea10_equipment ble_impl); meaning proven from the app.
const OPS = {
  OKECP: 'drive mode / gear + sport mode',
  OKSCM: 'lock / unlock',
  OKSCT: 'power on / off',
  OKXWM: 'command mode normal(0) / test(2), gated by OKAI_CAR',
  OKNAM: 'set BLE name',
  OKURD: 'firmware data chunk (custom OTA)',
  OKPWD: 'password check'
};
// Full proven-opcode set for the expert quick-insert. Every opcode below has a proven AT/QAT write or a
// proven RESP/ACK parser in the decompiled dial tree; meaning is from a named ext where one exists
// (OKLED headlight.dart, OKDSX cruising.dart, OKSUM start_without_assistance.dart, OKATL ambient_light.dart,
// OKLNM nfc.dart, OKSTY dial.dart), else from the parser name. Inserting an opcode only fills the builder.
const QUICK_OPS = {
  OKECP: 'drive mode / gear + sport mode', OKSCM: 'lock / unlock', OKSCT: 'power on / off',
  OKXWM: 'command mode normal(0)/test(2), gated by OKAI_CAR', OKNAM: 'set BLE name', OKPWD: 'password check',
  OKLED: 'headlight', OKDSX: 'cruise control', OKSUM: 'start without assistance', OKATL: 'ambient light',
  OKLNM: 'NFC', OKSTY: 'dial style', OKBCL: 'battery (read)', OKMLK: 'mileage (read)',
  OKWHS: 'wheel size (read)', OKINF: 'info (read)', OKASV: 'version (read)', OKSDF: 'factory / status',
  OKFCG: 'config', OKURD: 'firmware data chunk (OTA)'
};
// 25 dial-AT scooters share the identical 2c00/2c01/2c03 transport (zk family + helmet differ, not covered).
const MODELS = ['ea10', 'ea10a', 'ea10c', 'ea20', 'eb10', 'eb20', 'eb40', 'eb50', 'eb60', 'eb70', 'eb80',
  'eb80_kd', 'eb300', 'ebf20', 'es10', 'es20', 'es30', 'es30g2', 'es40', 'es50', 'es53', 'es200', 'es500', 'es520', 'es800'];

// --------------------------- helpers ---------------------------
const $ = (id) => document.getElementById(id);
const hex = (arr) => Array.from(arr, b => (b & 0xff).toString(16).padStart(2, '0').toUpperCase()).join(' ');
const short = (u) => String(u).slice(0, 8).toUpperCase();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const printable = (s) => String(s).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
const strToBytes = (s) => { const o = []; for (let i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 0xff); return o; };
const LS = { THEME: 'okai_theme', PUBLOG: 'okai_publog', DEV: 'okai_device', CMDPWD: 'okai_cmdpwd', SVCPWD: 'okai_svcpwd', MODEL: 'okai_model' };

let dev = null, server = null, writeCh = null, notifyCh = null, busy = false;
let connected = false;
let pendingDeepAction = null;   // 'unlock' | 'lock' from a ?do= shortcut

// live device state: the last RESP fields seen per opcode (tiles + decode read from this; never faked)
const lastResp = {};            // opcode -> array of raw fields (seq stripped)
function resetState() { for (const k of Object.keys(lastResp)) delete lastResp[k]; }

// --------------------------- log (eg-unlock redaction pipeline: scrub secrets + anonymize PII) ---------------------------
let logBuffer = [];   // { raw, cls }
let publicLog = true; // anonymize device name/id/MAC on display/copy/save (default on)
let diag = false;     // verbose diagnostics (default off)
function redact(text) {
  let s = String(text);
  if (dev && dev.id) s = s.split(dev.id).join('[redacted-id]');
  s = s.replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '[redacted-mac]');
  s = s.replace(/\b(secret|token|key|aes|pwd|password|pin|mac|serial|vin|uid|imei)\b(\s*[:=]\s*)("?)([^\s",]+)\3/gi,
    (m, k, sep) => k + sep + '[redacted]');
  s = s.replace(/\b[0-9A-Fa-f]{16,}\b/g, '[redacted-hex]');
  return s;
}
// Unconditional secret scrubber, runs at the source before the buffer (independent of the Public Log toggle).
function maskSecrets(text) {
  let s = String(text);
  s = s.replace(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, '[redacted-jwt]');
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ***');
  s = s.replace(/\b(access[_-]?token|refresh[_-]?token|token|jwt|password|passwd|pwd|secret|code|otp)\b(\s*[:=]\s*)("?)([^\s",}]+)\3/gi,
    (m, k, sep) => k + sep + '***');
  return s;
}
function anonymize(s) {
  if (!publicLog) return String(s).replace(/\x01/g, '');
  return redact(String(s).replace(/\x01[^\x01]*\x01/g, 'XX').replace(/\x01/g, ''));
}
function logLine(cls, text) {
  const safe = '[' + new Date().toTimeString().slice(0, 8) + '] ' + maskSecrets(text);
  logBuffer.push({ raw: safe, cls: cls });
  const el = $('log'); if (!el) return;
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = anonymize(safe) + '\n';
  el.appendChild(span); el.scrollTop = el.scrollHeight;
}
function renderLog() {
  const el = $('log'); if (!el) return;
  el.textContent = '';
  for (const e of logBuffer) { const span = document.createElement('span'); if (e.cls) span.className = e.cls; span.textContent = anonymize(e.raw) + '\n'; el.appendChild(span); }
  el.scrollTop = el.scrollHeight;
}
function logText() { return logBuffer.map(e => anonymize(e.raw)).join('\n'); }
const logTx = (s) => logLine('log-tx', '>>> ' + short(U.WRITE) + ' | ' + printable(s));
const logRx = (s) => logLine('log-rx', '<<< ' + short(U.NOTIFY) + ' | ' + printable(s));
const logSys = (t) => logLine('', '--- ' + t);
const logErr = (t) => logLine('log-err', '!!! ' + t);
const logDiag = (t) => { if (diag) logLine('', '... ' + t); };
// CRLF on Windows so the copied log pastes cleanly into Notepad (nv osNewline polish).
function osNewline() { return (navigator.platform || '').toLowerCase().indexOf('win') === 0 ? '\r\n' : '\n'; }
function saveLog() {
  try {
    const blob = new Blob([logText().split('\n').join(osNewline())], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'laufbursche42-okai-log.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    logSys('log saved');
  } catch (e) { logErr('save failed: ' + (e && e.message ? e.message : e)); }
}
function logDiagnosticHeader() {
  logLine('', '=== okai-unlock diagnostic ===');
  logLine('', 'build: ' + BUILD);
  logLine('', 'time: ' + new Date().toISOString());
  logLine('', 'userAgent: ' + (navigator.userAgent || '?'));
  logLine('', 'platform: ' + (navigator.platform || '?'));
  logLine('', 'webBluetooth: ' + (navigator.bluetooth ? 'yes' : 'no'));
  logLine('', 'protocol self-test: ' + (FRAME_OK ? 'OK' : 'FAILED'));
  logLine('', '================================');
}

// --------------------------- AT frame (DefaultPacker.packAT; no checksum, plaintext ASCII) ---------------------------
// "AT+" + opcode + "=" + fields.join(",") + "," + seq(4hex) + "$\r\n"  -- seq is a plain 16-bit counter.
let seqCounter = 0;
function nextSeq() { seqCounter = (seqCounter + 1) & 0xffff; return seqCounter; }
function seqHex(n) { return (n & 0xffff).toString(16).toUpperCase().padStart(4, '0'); }
function packAT(op, fields, seq) {
  const f = (fields || []).map(x => String(x));
  const head = 'AT+' + op + '=';
  const tail = seqHex(seq) + '$\r\n';
  return f.length ? head + f.join(',') + ',' + tail : head + tail;   // query with no data field = op + seq only
}
// a built frame must look like a real AT line (used by the self-test and the RX splitter)
function validAT(s) { const t = s.replace(/\r?\n+$/, ''); return /^AT\+[A-Za-z0-9_]{2,6}=/.test(t) && t.endsWith('$'); }
// parse a RESP frame into { op, fields, seq, raw }. The trailing 4-hex field is the seq (framing), stripped
// heuristically - OKAI uses plaintext AT fields with no documented per-field layout, so fields are kept raw and never decoded.
function parseAT(frame) {
  const m = frame.replace(/\r?\n+$/, '').match(/^AT\+([A-Za-z0-9_]{2,6})=([\s\S]*)\$$/);
  if (!m) return null;
  const op = m[1];
  const fields = m[2].length ? m[2].split(',') : [];
  let seq = null;
  if (fields.length && /^[0-9A-Fa-f]{4}$/.test(fields[fields.length - 1])) seq = fields.pop();
  return { op: op, fields: fields, seq: seq, raw: frame };
}

// load-time self-test: builder must match hand-computed vectors, and re-validate as a well-formed AT line
const FRAME_OK = (function () {
  const t1 = packAT('OKPWD', ['OKAIYLBT'], 1) === 'AT+OKPWD=OKAIYLBT,0001$\r\n';
  const t2 = packAT('OKXWM', ['OKAI_CAR', '0'], 2) === 'AT+OKXWM=OKAI_CAR,0,0002$\r\n';
  const t3 = packAT('OKSCM', ['OKAIYLBT', '1'], 0xABCD) === 'AT+OKSCM=OKAIYLBT,1,ABCD$\r\n';
  return t1 && t2 && t3 && validAT(packAT('OKPWD', ['OKAIYLBT'], 1)) && validAT(packAT('OKNAM', [CMD_PWD, 'X'], 7));
})();

// --------------------------- tiles (raw RESP fields; value NOT decoded - offsets unproven) ---------------------------
// Each tile mirrors one proven opcode's raw RESP payload (every opcode here has a proven RESP/ACK parser
// in the dial parser tree). Meaning is proven from a named ext only for OKECP (gear.dart), OKSCM
// (locker.dart), OKSCT (power.dart) and OKATL (ambient_light.dart, AmbientLightExt via rawAtl - OKATL is
// ambient light, NOT firmware; the earlier "firmware" label was wrong and is corrected here). OKBCL,
// OKMLK, OKWHS and OKINF keep their inferred battery/mileage/wheel/info names from the parser name only.
// The byte/field layout + scaling for OKAI is undocumented (plaintext AT fields), so values are shown raw,
// never decoded.
const TILE_IDS = ['t-batt', 't-lock', 't-mode', 't-power', 't-mileage', 't-wheel', 't-info', 't-light'];
const TILE_OP = {
  't-batt': 'OKBCL', 't-lock': 'OKSCM', 't-mode': 'OKECP', 't-power': 'OKSCT',
  't-mileage': 'OKMLK', 't-wheel': 'OKWHS', 't-info': 'OKINF', 't-light': 'OKATL'
};
function setTile(id, val) { const el = $(id); if (el) el.textContent = (val == null ? '-' : val); }
function resetTiles() { TILE_IDS.forEach(id => setTile(id, null)); }
function fieldStr(op) { const r = lastResp[op]; return (r && r.length) ? r.join(',') : null; }
function refreshTiles() { TILE_IDS.forEach(id => setTile(id, fieldStr(TILE_OP[id]))); }

// --------------------------- all-frames decode (every RESP opcode, raw; labeled where the app proves it) ---------------------------
const OPCODE_LABEL = {
  OKECP: 'drive mode/gear', OKSCM: 'lock/unlock', OKSCT: 'power', OKXWM: 'cmd mode', OKNAM: 'name',
  OKURD: 'OTA chunk', OKPWD: 'password', OKBCL: 'battery', OKMLK: 'mileage', OKWHS: 'wheel size',
  OKINF: 'info', OKATL: 'ambient light', OKMAC: 'MAC', OKCNF: 'config', OKSDF: 'status/error',
  OKDSX: 'cruise control', OKSUM: 'start without assistance', OKLED: 'headlight', OKLNM: 'NFC',
  OKSTY: 'dial style', OKFCG: 'config', OKASV: 'version'
};
const seenFrames = {};   // opcode -> last raw frame string
function renderAllFrames() { /* raw-frames debug panel is not part of the canonical shell */ }

// --------------------------- i18n ---------------------------
let lang = 'de';
function table() { return (window.I18N && window.I18N[lang]) || {}; }
function t(key) { const v = table()[key]; return (typeof v === 'string') ? v : ''; }
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(n => { const v = t(n.getAttribute('data-t')); if (/[<&]/.test(v)) n.innerHTML = v; else n.textContent = v; }); // scan-ok: curated i18n values with markup (banner/disclaimer links); own table, not user input
  document.querySelectorAll('[data-t-ph]').forEach(n => { const v = t(n.getAttribute('data-t-ph')); if (v) n.setAttribute('placeholder', v); });
  ['GUIDE', 'README', 'LICENSE', 'PRIVACY', 'TRADEMARKS'].forEach(name => { const el = $('link-' + name.toLowerCase()); if (el) el.href = docFile(name); });
  { const el = $('langs'); if (el) el.setAttribute('aria-label', t('langGroup')); }
  { const el = $('build-ver'); if (el) el.textContent = t('buildLabel') + ' ' + BUILD; }
  document.querySelectorAll('#langs button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  renderSettings(); refreshTiles(); renderAllFrames(); updateShortcuts();
  { const el = $('status'); setStatus(el ? el.dataset.state : 'disconnected'); }
  { const dark = document.documentElement.getAttribute('data-theme') !== 'light'; const el = $('btn-theme'); if (el) { el.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark')); el.title = el.getAttribute('aria-label'); } }
}
function initLangSwitch() { document.querySelectorAll('#langs button').forEach(b => b.addEventListener('click', () => { lang = b.dataset.lang; applyLang(); })); }

// --------------------------- theme ---------------------------
function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const b = $('btn-theme');
  if (b) { b.textContent = dark ? '\u2600' : '\u263E'; b.setAttribute('aria-label', t(dark ? 'themeToLight' : 'themeToDark')); b.title = b.getAttribute('aria-label'); }
  try { localStorage.setItem(LS.THEME, dark ? 'dark' : 'light'); } catch (e) {}
}
function initTheme() {
  let saved = null; try { saved = localStorage.getItem(LS.THEME); } catch (e) {}
  applyTheme(saved !== 'light');
  const b = $('btn-theme'); if (b) b.addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light'));
}

// --------------------------- status ---------------------------
function statusLabel(s) {
  const map = { disconnected: 'stDisconnected', connecting: 'stConnecting', linking: 'stLinking', connected: 'stConnected', 'no-service': 'stNoService' };
  return t(map[s] || 'stDisconnected') || s;
}
function setStatus(s) {
  const el = $('status'); if (el) { el.dataset.state = s; el.textContent = statusLabel(s); }
  const cb = $('btn-conn');
  if (cb) { const on = (s === 'connecting' || s === 'linking' || s === 'connected'); cb.textContent = on ? t('btnDisconnect') : t('btnConnect'); cb.dataset.act = on ? 'disconnect' : 'connect'; }
}
function setControlsEnabled(on) {
  // cards hidden until connected (header/intro/connect/shortcut/log stay visible)
  ['live-card', 'batt-card', 'more-card', 'raw-card'].forEach(id => { const el = $(id); if (el) el.hidden = !on; });
  document.querySelectorAll('[data-conn]').forEach(e => { e.disabled = !on; });
}

// --------------------------- connect (acceptAll + GATT service is the real gate; 4x retry) ---------------------------
async function connect() {
  if (!navigator.bluetooth) { logErr(t('errNoWebBt')); return; }
  try {
    setStatus('connecting');
    const showAll = ($('showall') || {}).checked;
    const opts = showAll
      ? { acceptAllDevices: true, optionalServices: CANDIDATE_SERVICES }
      : { filters: [{ services: [U.MAIN] }, { services: [ADV_SERVICES[0]] }, { services: [ADV_SERVICES[1]] }], optionalServices: CANDIDATE_SERVICES };
    dev = await navigator.bluetooth.requestDevice(opts);
    dev.addEventListener('gattserverdisconnected', onDisconnected);
    try { localStorage.setItem(LS.DEV, dev.id); } catch (e) {}
    logSys('device: \x01' + (dev.name || '(no name)') + '\x01');
    setStatus('linking');
    await connectGatt();
    setStatus('connected'); connected = true;
    setControlsEnabled(true);
    { const el = $('devinfo'); if (el) el.textContent = t('devPrefix') + ' \x01' + (dev.name || 'OKAI') + '\x01'; }
    logSys('connected, write ' + short(U.WRITE) + ' notify ' + short(U.NOTIFY));
    await maybeRunDeepAction();
  } catch (e) {
    logErr('connect failed: ' + (e && e.message ? e.message : e));
    connected = false; setStatus('disconnected'); setControlsEnabled(false);
  }
}
// tolerate the Android discovery race (nv 4x retry): service can be briefly absent right after link.
async function connectGatt() {
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      server = await dev.gatt.connect();
      const svc = await resolveService(server);
      if (!svc) { setStatus('no-service'); throw new Error('OKAI service ' + short(U.MAIN) + ' not found'); }
      writeCh = await svc.getCharacteristic(U.WRITE);
      notifyCh = await svc.getCharacteristic(U.NOTIFY);
      await notifyCh.startNotifications();
      notifyCh.addEventListener('characteristicvaluechanged', onCharValue);
      return;
    } catch (e) {
      lastErr = e; logDiag('connect attempt ' + attempt + ' failed: ' + (e && e.message ? e.message : e));
      try { if (dev.gatt.connected) dev.gatt.disconnect(); } catch (_) {}
      await sleep(400);
    }
  }
  throw lastErr || new Error('gatt connect failed');
}
async function resolveService(srv) {
  for (const uuid of CANDIDATE_SERVICES) { try { return await srv.getPrimaryService(uuid); } catch (_) {} }
  return null;
}
function onDisconnected() {
  connected = false; writeCh = null; notifyCh = null; rxText = ''; setStatus('disconnected'); setControlsEnabled(false);
  resetState(); resetTiles(); clearAcks(); for (const k of Object.keys(seenFrames)) delete seenFrames[k];
  renderAllFrames();
  const el = $('devinfo'); if (el) el.textContent = '';
  logSys('disconnected');
}
function disconnect() { if (dev && dev.gatt.connected) dev.gatt.disconnect(); }

// --------------------------- notify + ACK (ASCII reassembly on $ terminator) ---------------------------
let rxText = '';
function onCharValue(ev) {
  const bytes = new Uint8Array(ev.target.value.buffer);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  logRx(s);
  rxText += s;
  // frames may be concatenated or split; reassemble from "AT+" to the "$" terminator
  for (let guardN = 0; guardN < 64; guardN++) {
    const start = rxText.indexOf('AT+');
    if (start < 0) { if (rxText.length > 512) rxText = ''; break; }
    if (start > 0) rxText = rxText.slice(start);
    const end = rxText.indexOf('$');
    if (end < 0) { if (rxText.length > 512) rxText = ''; break; }
    const frame = rxText.slice(0, end + 1);
    rxText = rxText.slice(end + 1).replace(/^\r?\n/, '');
    handleFrame(frame);
  }
}
function handleFrame(frame) {
  const p = parseAT(frame);
  if (!p) { logDiag('unparsed frame dropped: ' + printable(frame)); return; }
  lastResp[p.op] = p.fields;
  seenFrames[p.op] = frame;
  resolveAck('op:' + p.op);
  refreshTiles(); renderAllFrames();
}
const pendingAcks = new Map();
const ACK_TIMEOUT_MS = 3000;
function armAck(key, label) {
  clearAckTimer(key);
  const timer = setTimeout(() => { pendingAcks.delete(key); logSys(label + ': ' + t('ackNone')); }, ACK_TIMEOUT_MS);
  pendingAcks.set(key, { timer, label });
}
function resolveAck(key) { const a = pendingAcks.get(key); if (a) { clearTimeout(a.timer); pendingAcks.delete(key); logSys(a.label + ': ' + t('ackOk')); } }
function clearAckTimer(key) { const a = pendingAcks.get(key); if (a) { clearTimeout(a.timer); pendingAcks.delete(key); } }
function clearAcks() { for (const a of pendingAcks.values()) clearTimeout(a.timer); pendingAcks.clear(); }

// --------------------------- transmit (single funnel: log TX, arm ack, write) ---------------------------
async function writeFrame(bytes) {
  const arr = Uint8Array.from(bytes);
  // universal_ble picks write-type from the characteristic properties at runtime; mirror that (prefer WNR for AT bridges).
  if (writeCh.properties.writeWithoutResponse) return writeCh.writeValueWithoutResponse(arr);
  if (writeCh.properties.write) return writeCh.writeValueWithResponse(arr);
  return writeCh.writeValue(arr);
}
async function transmit(atStr, label, ackKey) {
  if (!connected || !writeCh) { logErr(t('errNotConnected')); return; }
  logTx(atStr);
  if (ackKey) armAck(ackKey, label);
  try { await writeFrame(strToBytes(atStr)); logSys(label + ': ' + t('txSent')); }
  catch (e) { clearAckTimer(ackKey); logErr(label + ' ' + t('txFailed') + ': ' + (e && e.message ? e.message : e)); }
}
// serialize writes on the single characteristic (eg guard mutex; vr/ap/vmax omit it)
async function guard(fn) { if (busy) return; busy = true; try { await fn(); } catch (e) { logErr(e && e.message ? e.message : String(e)); } finally { busy = false; } }

// --------------------------- commands (real proven opcodes; unproven field VALUES are gated + disclosed) ---------------------------
function cmdPwd() { const v = ($('cmd-pwd') || {}).value; return (v && v.trim()) ? v.trim() : CMD_PWD; }
function svcPwd() { const v = ($('svc-pwd') || {}).value; return (v && v.trim()) ? v.trim() : SVC_PWD; }
// OKSCM lock/unlock: opcode+meaning proven; the exact value (1 vs 0 for lock/unlock) is an ASSUMPTION, gated.
async function doLock(on) {
  if (!await confirmRisky(t(on ? 'warnLock' : 'warnUnlock'))) return;
  await transmit(packAT('OKSCM', [cmdPwd(), on ? '1' : '0'], nextSeq()), t(on ? 'btnImmobLock' : 'btnImmobUnlock'), 'op:OKSCM');
}
// OKXWM normal(0)/test(2): the 0/2 values ARE proven; gated by the OKAI_CAR service password.
async function setMode(v) {
  if (v === '2' && !await confirmRisky(t('warnTestMode'))) return;
  await transmit(packAT('OKXWM', [svcPwd(), v], nextSeq()), t('setCmdMode'), 'op:OKXWM');
}
// OKNAM set name: the name is user-supplied (not invented); command password in the payload.
async function setName(name) {
  if (!name) { logErr(t('errNoName')); return; }
  await transmit(packAT('OKNAM', [cmdPwd(), name], nextSeq()), t('setName'), 'op:OKNAM');
}
// OKECP drive mode / gear: opcode+meaning proven; the mode/gear number is user-supplied, not invented.
async function setEcp(v) {
  if (v === '' || v == null || isNaN(Number(v))) { logErr(t('errNoValue')); return; }
  await transmit(packAT('OKECP', [cmdPwd(), String(v)], nextSeq()), t('set_mode'), 'op:OKECP');
}
// OKSCT power on/off: opcode+meaning proven; command password in the payload.
async function doPower(on) {
  if (!on && !await confirmRisky(t('warnPowerOff'))) return;
  await transmit(packAT('OKSCT', [cmdPwd(), on ? '1' : '0'], nextSeq()), t(on ? 'btnPowerOn' : 'btnPowerOff'), 'op:OKSCT');
}
// Proven-meaning writable params that each own a dedicated opcode and a named ext (OKLED headlight.dart,
// OKDSX cruising.dart, OKSUM start_without_assistance.dart, OKATL ambient_light.dart). Field 2 = command
// password per the universal frame rule; the parameter VALUE mapping is model-specific and unproven, so
// the value is a free user input, mirroring the OKECP gear row - never an invented on/off number.
async function sendParam(op, v, label) {
  if (v === '' || v == null || isNaN(Number(v))) { logErr(t('errNoValue')); return; }
  await transmit(packAT(op, [cmdPwd(), String(v)], nextSeq()), label, 'op:' + op);
}

// --------------------------- expert tier (AT builder + raw verbatim; details is the gate) ---------------------------
async function cmdAt() {
  let op = (($('at-op') || {}).value || '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,6}$/.test(op)) { logErr(t('errBadOp')); return; }
  const raw = (($('at-fields') || {}).value || '').trim();
  const fields = raw ? raw.split(',').map(x => x.trim()) : [];
  await transmit(packAT(op, fields, nextSeq()), t('atLabel') + ' ' + op, 'op:' + op);
}
async function cmdRaw() {
  const line = (($('raw-in') || {}).value || '');
  if (!line.length) { logErr(t('errNoBytes')); return; }
  // sent verbatim (CRLF appended if absent so the device sees a terminated line); no seq/opcode added
  const out = /\r?\n$/.test(line) ? line : line + '\r\n';
  await transmit(out, t('rawLabel'));
}

// --------------------------- shortcut deep-link (?do=unlock|lock -> OKSCM) ---------------------------
function parseDeepLink() {
  const q = new URLSearchParams(location.search); let a = q.get('do');
  if (!a && location.hash) { const m = location.hash.match(/do=([a-z]+)/i); if (m) a = m[1]; }
  if (!a) return;
  a = a.toLowerCase();
  if (a === 'unlock') pendingDeepAction = 'unlock';
  else if (a === 'lock') pendingDeepAction = 'lock';
}
async function maybeRunDeepAction() {
  if (!pendingDeepAction) return;
  const act = pendingDeepAction; pendingDeepAction = null;
  if (act === 'unlock') await guard(() => doLock(false));
  else await guard(() => doLock(true));
}
async function tryAutoReconnect() {
  if (!pendingDeepAction || !navigator.bluetooth || !navigator.bluetooth.getDevices) return;
  try {
    const list = await navigator.bluetooth.getDevices(); let saved = null; try { saved = localStorage.getItem(LS.DEV); } catch (e) {}
    const d = list.find(x => x.id === saved) || list[0]; if (!d) return;
    dev = d; dev.addEventListener('gattserverdisconnected', onDisconnected);
    setStatus('linking'); await connectGatt(); setStatus('connected'); connected = true; setControlsEnabled(true);
    logSys('auto-reconnect (shortcut)'); await maybeRunDeepAction();
  } catch (e) { logDiag('auto-reconnect skipped: ' + (e && e.message ? e.message : e)); }
}
function updateShortcuts() {
  const base = location.origin + location.pathname;
  const set = (id, action) => { const el = $(id); if (el) el.textContent = 'bluefy://open?url=' + encodeURIComponent(base + '?do=' + action); };
  set('sc-unlock', 'unlock'); set('sc-lock', 'lock');
}

// --------------------------- settings engine (kept as no-op: OKAI rows are hand-authored, not report-gated) ---------------------------
const SETTINGS = [];
function renderSettings() { const box = $('settings-body'); if (!box) return; box.textContent = ''; }
function applyReportToSettings() { /* OKAI does not report its write-register state, so nothing to reveal */ }

// model dropdown (label only; the 25 dial models share the identical 2c00/2c01/2c03 transport)
function buildModelDropdown() {
  const sel = $('model-in'); if (!sel) return;
  sel.textContent = '';
  const auto = document.createElement('option'); auto.value = 'auto'; auto.setAttribute('data-t', 'modelAuto'); auto.textContent = t('modelAuto');
  sel.appendChild(auto);
  MODELS.forEach(m => { const opt = document.createElement('option'); opt.value = m; opt.textContent = m.toUpperCase(); sel.appendChild(opt); });
  let saved = null; try { saved = localStorage.getItem(LS.MODEL); } catch (e) {}
  sel.value = (saved && (saved === 'auto' || MODELS.indexOf(saved) >= 0)) ? saved : 'auto';
}

// expert op quick-insert buttons (every proven opcode, write and read; see QUICK_OPS)
function renderOpQuick() {
  const box = $('op-quick'); if (!box) return;
  box.textContent = '';
  for (const op of Object.keys(QUICK_OPS)) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = op; b.title = QUICK_OPS[op];
    b.setAttribute('data-conn', ''); b.disabled = !connected;
    b.addEventListener('click', () => { const i = $('at-op'); if (i) i.value = op; });
    box.appendChild(b);
  }
}

// --------------------------- confirm dialog (themed; window.confirm fallback) ---------------------------
function confirmRisky(msg) {
  return new Promise(resolve => {
    const dlg = $('confirm'); const body = $('confirm-body');
    if (!dlg || !dlg.showModal) { resolve(window.confirm(msg)); return; }
    if (body) body.textContent = msg;
    const ok = $('confirm-ok'), cancel = $('confirm-x'), no = $('confirm-no');
    const done = (v) => { dlg.close(); ok.removeEventListener('click', onOk); if (no) no.removeEventListener('click', onNo); if (cancel) cancel.removeEventListener('click', onNo); resolve(v); };
    const onOk = () => done(true), onNo = () => done(false);
    ok.addEventListener('click', onOk); if (no) no.addEventListener('click', onNo); if (cancel) cancel.addEventListener('click', onNo);
    dlg.showModal();
  });
}

// --------------------------- doc viewer (markdown of our own docs) ---------------------------
const DOC_TITLES = { 'GUIDE.de.md': 'footGuide', 'GUIDE.en.md': 'footGuide', 'README.md': 'footReadme', 'LICENSE.de.md': 'footLicense', 'LICENSE.md': 'footLicense', 'PRIVACY.de.md': 'footPrivacy', 'PRIVACY.md': 'footPrivacy', 'TRADEMARKS.de.md': 'footTrademarks', 'TRADEMARKS.md': 'footTrademarks', 'DISCLAIMER.de.md': 'footDisclaimer', 'DISCLAIMER.md': 'footDisclaimer' };
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = s => s.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
function docFile(name) { if (name === 'README') return 'README.md'; if (name === 'GUIDE') return 'GUIDE.' + lang + '.md'; return name + (lang === 'de' ? '.de.md' : '.md'); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, text, href) {
      if (DOC_TITLES[href]) return '<a href="' + href + '" data-docfile="' + href + '">' + text + '</a>';
      return '<a href="' + href + '" target="_blank" rel="noopener">' + text + '</a>';
    });
}
function mdToHtml(md) {
  var codeBlocks = [];
  // 1) pull fenced code blocks out first so their content is never treated as markdown
  md = String(md).replace(/```[^\n]*\n?([\s\S]*?)```/g, function (m, code) {
    var i = codeBlocks.length;
    codeBlocks.push('<pre><code>' + esc(code.replace(/\n$/, '')) + '</code></pre>');
    return '\x00CB' + i + '\x00';
  });
  var lines = md.split(/\r?\n/);
  var out = [], para = [], list = null;
  function flushPara() { if (para.length) { out.push('<p>' + inlineMd(esc(para.join(' '))) + '</p>'); para = []; } }
  function flushList() { if (list) { out.push('<' + list.type + '>' + list.items.join('') + '</' + list.type + '>'); list = null; } }
  function isTableSep(s) { var tt = s.replace(/\s/g, ''); return /^\|?:?-+:?(\|:?-+:?)+\|?$/.test(tt); }
  function splitRow(s) { return s.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function (c) { return c.trim(); }); }
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    var cb = ln.match(/^\x00CB(\d+)\x00$/);
    if (cb) { flushPara(); flushList(); out.push(codeBlocks[Number(cb[1])]); continue; }
    if (/^\s*$/.test(ln)) { flushPara(); flushList(); continue; }
    var h = ln.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); var lvl = Math.min(h[1].length, 4); out.push('<h' + lvl + '>' + inlineMd(esc(h[2])) + '</h' + lvl + '>'); continue; }
    if (/^---+$/.test(ln.trim())) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if (ln.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {   // GFM table: header, |---| sep, rows
      flushPara(); flushList();
      var head = splitRow(ln); i++;   // consume the separator row
      var body = '';
      while (i + 1 < lines.length && lines[i + 1].indexOf('|') >= 0 && lines[i + 1].trim() !== '') {
        body += '<tr>' + splitRow(lines[++i]).map(function (c) { return '<td>' + inlineMd(esc(c)) + '</td>'; }).join('') + '</tr>';
      }
      out.push('<table><thead><tr>' + head.map(function (c) { return '<th>' + inlineMd(esc(c)) + '</th>'; }).join('') + '</tr></thead><tbody>' + body + '</tbody></table>');
      continue;
    }
    if (/^\s*>/.test(ln)) {                             // merge consecutive > lines into ONE callout
      flushPara(); flushList();
      var q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      i--;                                              // step back; the for-loop re-increments
      while (q.length && /^\s*$/.test(q[0])) q.shift();
      while (q.length && /^\s*$/.test(q[q.length - 1])) q.pop();
      if (q.length) out.push('<blockquote>' + mdToHtml(q.join('\n')) + '</blockquote>');  // inner rendered as markdown
      continue;
    }
    var ul = ln.match(/^\s*[-*]\s+(.*)$/);
    var ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      var type = ul ? 'ul' : 'ol';
      if (!list || list.type !== type) { flushList(); list = { type: type, items: [] }; }
      list.items.push('<li>' + inlineMd(esc((ul ? ul[1] : ol[1]))) + '</li>');
      continue;
    }
    para.push(ln.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}
const docCache = {};
async function openDocFile(file) {
  const dlg = $('doc'); const titleEl = $('doc-title'); const bodyEl = $('doc-body');
  titleEl.textContent = t(DOC_TITLES[file] || 'footReadme');
  if (lang === 'de' && /\.md$/.test(file) && !/\.de\.md$/.test(file) && file !== 'README.md') titleEl.textContent += ' (englisch)';
  try { if (!docCache[file]) { const r = await fetch(file); docCache[file] = await r.text(); } bodyEl.innerHTML = mdToHtml(docCache[file]); } // scan-ok: own in-repo markdown rendered via mdToHtml; not user input
  catch (e) { bodyEl.textContent = 'Could not load ' + file; }
  if (dlg.showModal) dlg.showModal();
}
function wireDocViewer() {
  // delegated: footer doc links, the intro guide link (injected by i18n at runtime), in-doc links, disclaimer
  document.addEventListener('click', e => {
    const d = e.target.closest('a[data-doc]'); if (d) { e.preventDefault(); openDocFile(docFile(d.getAttribute('data-doc'))); return; }
    const df = e.target.closest('a[data-docfile]'); if (df) { e.preventDefault(); openDocFile(df.getAttribute('data-docfile')); return; }
    const disc = e.target.closest('[data-open-disclaimer]'); if (disc) { e.preventDefault(); openDocFile(docFile('DISCLAIMER')); return; }
  });
  ['doc-x', 'doc-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', () => $('doc').close()); });
}

// --------------------------- help modal ---------------------------
const HELP = ['connect', 'live', 'speed', 'immob', 'more', 'expert', 'shortcut'];
function openHelp(key) { openHelpText(t('help_' + key + '_t'), t('help_' + key + '_b')); }
function openHelpText(title, body) {
  const dlg = $('help'); $('help-title').textContent = title || ''; const b = $('help-body'); if (/[<&]/.test(body || '')) b.innerHTML = body; else b.textContent = body || ''; // scan-ok: curated i18n help text; own table, not user input
  if (dlg.showModal) dlg.showModal();
}
function closeHelp() { const d = $('help'); if (d) d.close(); }

// --------------------------- init ---------------------------
window.addEventListener('DOMContentLoaded', () => {
  initLangSwitch(); initTheme(); wireDocViewer(); renderSettings(); renderOpQuick(); buildModelDropdown();
  { const sel = $('model-in'); if (sel) sel.addEventListener('change', () => { try { localStorage.setItem(LS.MODEL, sel.value); } catch (e) {} }); }
  try { const p = localStorage.getItem(LS.CMDPWD); if (p && $('cmd-pwd')) $('cmd-pwd').value = p; } catch (e) {}
  try { const p = localStorage.getItem(LS.SVCPWD); if (p && $('svc-pwd')) $('svc-pwd').value = p; } catch (e) {}
  applyLang(); setStatus('disconnected'); resetTiles();
  logDiagnosticHeader();
  if (!FRAME_OK) logErr('protocol self-test FAILED - builder does not match known vectors; do not trust writes');

  $('btn-conn').addEventListener('click', () => { if ($('btn-conn').dataset.act === 'disconnect') disconnect(); else guard(connect); });
  { const p = $('cmd-pwd'); if (p) p.addEventListener('change', () => { try { localStorage.setItem(LS.CMDPWD, p.value); } catch (e) {} }); }
  { const p = $('svc-pwd'); if (p) p.addEventListener('change', () => { try { localStorage.setItem(LS.SVCPWD, p.value); } catch (e) {} }); }

  { const b = $('btn-immob-lock'); if (b) b.addEventListener('click', () => guard(() => doLock(true))); }
  { const b = $('btn-immob-unlock'); if (b) b.addEventListener('click', () => guard(() => doLock(false))); }
  { const b = $('btn-ecp'); if (b) b.addEventListener('click', () => guard(() => setEcp((($('ecp-in') || {}).value || '').trim()))); }
  { const b = $('btn-power-on'); if (b) b.addEventListener('click', () => guard(() => doPower(true))); }
  { const b = $('btn-power-off'); if (b) b.addEventListener('click', () => guard(() => doPower(false))); }
  { const b = $('btn-mode'); if (b) b.addEventListener('click', () => guard(() => setMode(($('sel-mode') || {}).value || '0'))); }
  { const b = $('btn-name'); if (b) b.addEventListener('click', () => guard(() => setName((($('name-in') || {}).value || '').trim()))); }
  { const b = $('btn-led'); if (b) b.addEventListener('click', () => guard(() => sendParam('OKLED', (($('led-in') || {}).value || '').trim(), t('set_headlight')))); }
  { const b = $('btn-dsx'); if (b) b.addEventListener('click', () => guard(() => sendParam('OKDSX', (($('dsx-in') || {}).value || '').trim(), t('set_cruise')))); }
  { const b = $('btn-sum'); if (b) b.addEventListener('click', () => guard(() => sendParam('OKSUM', (($('sum-in') || {}).value || '').trim(), t('set_startassist')))); }
  { const b = $('btn-atl'); if (b) b.addEventListener('click', () => guard(() => sendParam('OKATL', (($('atl-in') || {}).value || '').trim(), t('set_ambient')))); }

  { const b = $('btn-at'); if (b) b.addEventListener('click', () => guard(cmdAt)); }
  { const b = $('btn-raw'); if (b) b.addEventListener('click', () => guard(cmdRaw)); }

  document.querySelectorAll('.help-btn[data-help]').forEach(btn => btn.addEventListener('click', () => openHelp(btn.getAttribute('data-help'))));
  ['help-x', 'help-close'].forEach(id => { const b = $(id); if (b) b.addEventListener('click', closeHelp); });
  { const b = $('link-disclaimer'); if (b) b.addEventListener('click', e => { e.preventDefault(); openDocFile(docFile('DISCLAIMER')); }); }

  { const cb = $('public-log'); if (cb) { let saved = null; try { saved = localStorage.getItem(LS.PUBLOG); } catch (e) {} publicLog = saved !== '0'; cb.checked = publicLog; cb.addEventListener('change', () => { publicLog = cb.checked; try { localStorage.setItem(LS.PUBLOG, cb.checked ? '1' : '0'); } catch (e) {} logSys('public-log: ' + (cb.checked ? 'on (anonymizing device name/id)' : 'off')); renderLog(); }); } }
  { const cb = $('diag-log'); if (cb) { cb.addEventListener('change', () => { diag = cb.checked; logSys(diag ? 'diagnostic log on' : 'diagnostic log off'); }); } }
  { const cb = $('showall'); if (cb) cb.addEventListener('change', () => { logSys('show-all-frames: ' + (cb.checked ? 'on' : 'off')); renderLog(); }); }
  { const b = $('btn-clear-log'); if (b) b.addEventListener('click', () => { logBuffer = []; $('log').textContent = ''; logDiagnosticHeader(); }); }
  { const b = $('btn-copy-log'); if (b) b.addEventListener('click', () => navigator.clipboard.writeText(logText()).then(() => logSys('log copied')).catch(() => {})); }
  { const b = $('btn-save-log'); if (b) b.addEventListener('click', saveLog); }

  updateShortcuts();
  parseDeepLink();
  if (pendingDeepAction) { logSys(t('scPending')); tryAutoReconnect(); }
});
