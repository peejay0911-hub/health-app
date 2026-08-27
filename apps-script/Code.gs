// ================= CONFIG =================
const SHEET_NAME = 'Log';
const TOKEN = 'REPLACE-WITH-A-LONG-RANDOM-STRING';
const API = 'https://health.googleapis.com/v4/users/me/dataTypes/';

// health.googleapis.com rejects any access token that also carries non-health
// scopes (it named script.external_request and spreadsheets.currentonly as
// "disallowed_scopes" in a 403). ScriptApp.getOAuthToken() always carries every
// scope the script holds, so Health calls use a separate OAuth client that asks
// for the three health scopes and nothing else. Its id/secret live in Script
// Properties, never in this file.
const HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly'
].join(' ');
const COLS = ['date','weight','steps','sleep','burn','kcal','protein','fat',
              'carbs','rhr','peak_hr','training','dose','mood','note'];

// ================ WEB APP =================
function doGet(e) {
  const p = e.parameter || {};
  if (p.token !== TOKEN) return out_({ error: 'bad token' });
  try {
    if (p.action === 'pull') {
      const date = p.date || today_();
      const pulled = pullDay_(date);
      upsertRow_(date, pulled);
      return out_({ ok: true, date: date, row: readRow_(date), errors: pulled._errors });
    }
    if (p.action === 'log') {
      if (!p.date) return out_({ error: 'date required' });
      const fields = {};
      COLS.forEach(c => { if (p[c] !== undefined) fields[c] = p[c]; });
      upsertRow_(p.date, fields);
      return out_({ ok: true, row: readRow_(p.date) });
    }
    if (p.action === 'read') {
      const days = Math.min(Number(p.days) || 30, 120);
      return out_({ rows: readLast_(days) });
    }
    return out_({ error: 'unknown action (use pull, log, or read)' });
  } catch (err) {
    return out_({ error: String(err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============ NIGHTLY TRIGGER =============
// Attach a daily 5-6am time-driven trigger to this. Pulls yesterday's
// final numbers after the night's sleep has synced.
function healthNightlyPull() {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const date = Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
  upsertRow_(date, pullDay_(date));
}

// Run this once by hand to authorize and smoke-test.
function testPullToday() {
  const date = today_();
  const pulled = pullDay_(date);
  Logger.log(JSON.stringify(pulled, null, 2));
  upsertRow_(date, pulled);
}

// ============== HEALTH API ================
function pullDay_(date) {
  const r = { _errors: [] };
  const attempt = (label, fn) => {
    try { return fn(); }
    catch (err) { r._errors.push(label + ': ' + String(err).slice(0, 200)); return ''; }
  };

  r.steps = attempt('steps', () => {
    const d = apiGetDay_('steps', 'steps', date);
    const vals = findNums_(d, ['steps', 'count']);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : '';
  });

  r.burn = attempt('burn', () => {
    const d = apiGetDay_('calories-burned', 'calories_burned', date);
    const vals = findNums_(d, ['caloriesKcal', 'calories', 'energyKcal']);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0)) : '';
  });

  r.rhr = attempt('rhr', () => {
    const d = apiGetDay_('resting-heart-rate', 'resting_heart_rate', date);
    const vals = findNums_(d, ['beatsPerMinute', 'bpm']);
    return vals.length ? vals[vals.length - 1] : '';
  });

  r.peak_hr = attempt('peak_hr', () => {
    const vals = findNums_(apiGetDay_('heart-rate', 'heart_rate', date),
                           ['beatsPerMinute', 'bpm']);
    return vals.length ? Math.max.apply(null, vals) : '';
  });

  r.weight = attempt('weight', () => {
    const d = apiGetDay_('weight', 'weight', date);
    const kg = findNums_(d, ['weightKg']);
    if (kg.length) return Math.round(kg[kg.length - 1] * 2.20462 * 10) / 10;
    const lb = findNums_(d, ['weightLb', 'weightPounds']);
    return lb.length ? lb[lb.length - 1] : '';
  });

  r.sleep = attempt('sleep', () => {
    const d = apiGetDay_('sleep', 'sleep', date);
    const mins = findNums_(d, ['minutesAsleep', 'totalMinutesAsleep']);
    if (!mins.length) return '';
    const m = Math.max.apply(null, mins);
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  });

  return r;
}

// Fetch one data type for one civil date. Tries the documented filter
// grammars in order; different data kinds use different time fields.
function apiGetDay_(type, filterPrefix, date) {
  const day0 = date + 'T00:00:00';
  const day1 = date + 'T23:59:59';
  const filters = [
    `${filterPrefix}.interval.civil_start_time >= "${day0}" AND ${filterPrefix}.interval.civil_start_time <= "${day1}"`,
    `${filterPrefix}.date == "${date}"`,
    `${filterPrefix}.sample_time.civil_time >= "${day0}" AND ${filterPrefix}.sample_time.civil_time <= "${day1}"`,
    `${filterPrefix}.interval.start_time >= "${utc_(day0)}" AND ${filterPrefix}.interval.start_time <= "${utc_(day1)}"`,
    `${filterPrefix}.sample_time.physical_time >= "${utc_(day0)}" AND ${filterPrefix}.sample_time.physical_time <= "${utc_(day1)}"`,
    `${filterPrefix}.interval.end_time >= "${utc_(day0)}" AND ${filterPrefix}.interval.end_time <= "${utc_(day1)}"`
  ];
  let lastErr = null;
  for (let i = 0; i < filters.length; i++) {
    try {
      const first = apiGet_(type + '/dataPoints?pageSize=10000&filter=' +
                            encodeURIComponent(filters[i]));
      if (!first.dataPoints || !first.dataPoints.length) continue;
      let all = first, pages = 1;
      while (all.nextPageToken && pages < 5) {
        const next = apiGet_(type + '/dataPoints?pageSize=10000&pageToken=' +
                             all.nextPageToken + '&filter=' + encodeURIComponent(filters[i]));
        first.dataPoints = first.dataPoints.concat(next.dataPoints || []);
        all = next; pages++;
      }
      return first;
    } catch (err) { lastErr = err; }
  }
  if (lastErr) throw lastErr;
  return { dataPoints: [] };
}

function apiGet_(path) {
  const svc = healthService_();
  if (!svc.hasAccess()) {
    throw new Error('Health API not authorized. Run authorizeHealth() and open ' +
                    'the URL it logs. Last error: ' + svc.getLastError());
  }
  const res = UrlFetchApp.fetch(API + path, {
    headers: { Authorization: 'Bearer ' + svc.getAccessToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('HTTP ' + res.getResponseCode() + ' on ' + path.split('?')[0] +
                    ': ' + res.getContentText().slice(0, 200));
  }
  return JSON.parse(res.getContentText());
}

// ============== HEALTH AUTH ===============
// Uses the apps-script-oauth2 library, added under Libraries as `OAuth2`.
function healthService_() {
  const props = PropertiesService.getScriptProperties();
  return OAuth2.createService('googlehealth')
    .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/v2/auth')
    .setTokenUrl('https://oauth2.googleapis.com/token')
    .setClientId(props.getProperty('CLIENT_ID'))
    .setClientSecret(props.getProperty('CLIENT_SECRET'))
    .setCallbackFunction('authCallback')
    .setPropertyStore(props)
    .setScope(HEALTH_SCOPES)
    .setParam('access_type', 'offline')
    .setParam('prompt', 'consent');
}

// Run once by hand, then open the URL it logs.
function authorizeHealth() {
  const svc = healthService_();
  if (svc.hasAccess()) { Logger.log('Already authorized.'); return; }
  Logger.log('Open this URL to authorize:\n\n%s', svc.getAuthorizationUrl());
}

function authCallback(request) {
  return HtmlService.createHtmlOutput(
    healthService_().handleCallback(request)
      ? 'Authorized. Close this tab and re-run testPullToday().'
      : 'Denied. Close this tab.');
}

// Paste this into the OAuth client's Authorized redirect URIs.
function showRedirectUri() { Logger.log(healthService_().getRedirectUri()); }

// Clears the stored token; run before re-authorizing from scratch.
function resetHealthAuth() { healthService_().reset(); }

// Dumps raw API responses for one day so schema mismatches are easy to fix.
function debugDay() {
  ['steps', 'calories-burned', 'resting-heart-rate', 'heart-rate', 'weight', 'sleep']
    .forEach(t => {
      try {
        const raw = apiGet_(t + '/dataPoints?pageSize=3');
        Logger.log('==== %s ====\n%s', t, JSON.stringify(raw).slice(0, 3000));
      } catch (err) { Logger.log('==== %s ==== ERROR %s', t, err); }
    });
}

// ================ HELPERS =================
function findNums_(obj, keys) {
  const found = [];
  (function walk(o) {
    if (o && typeof o === 'object') {
      for (const k in o) {
        if (keys.indexOf(k) !== -1 && typeof o[k] === 'number') found.push(o[k]);
        else if (keys.indexOf(k) !== -1 && !isNaN(Number(o[k]))) found.push(Number(o[k]));
        else walk(o[k]);
      }
    }
  })(obj);
  return found;
}

function sheet_() { return SpreadsheetApp.getActive().getSheetByName(SHEET_NAME); }
function tz_() { return Session.getScriptTimeZone(); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function utc_(civil) {
  const d = Utilities.parseDate(civil, tz_(), "yyyy-MM-dd'T'HH:mm:ss");
  return Utilities.formatDate(d, 'GMT', "yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function upsertRow_(date, fields) {
  const sh = sheet_();
  const n = Math.max(sh.getLastRow() - 1, 1);
  const dates = sh.getRange(2, 1, n, 1).getDisplayValues().map(r => r[0]);
  let row = dates.indexOf(date) + 2;
  if (row === 1) { row = sh.getLastRow() + 1; sh.getRange(row, 1).setValue(date); }
  COLS.forEach((c, i) => {
    if (c !== 'date' && fields[c] !== undefined && fields[c] !== '') {
      sh.getRange(row, i + 1).setValue(fields[c]);
    }
  });
}

function readRow_(date) {
  const sh = sheet_();
  const n = Math.max(sh.getLastRow() - 1, 1);
  const dates = sh.getRange(2, 1, n, 1).getDisplayValues().map(r => r[0]);
  const idx = dates.indexOf(date);
  if (idx === -1) return null;
  const vals = sh.getRange(idx + 2, 1, 1, COLS.length).getDisplayValues()[0];
  const o = {};
  COLS.forEach((c, i) => o[c] = vals[i]);
  return o;
}

function readLast_(days) {
  const sh = sheet_();
  const last = sh.getLastRow();
  const n = Math.min(days, last - 1);
  if (n < 1) return [];
  return sh.getRange(last - n + 1, 1, n, COLS.length).getDisplayValues()
    .map(vals => { const o = {}; COLS.forEach((c, i) => o[c] = vals[i]); return o; });
}
