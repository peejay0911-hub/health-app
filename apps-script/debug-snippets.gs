// Diagnostics for the Health API. Paste into Code.gs when needed, run from the
// editor's function dropdown, then remove. Not part of the deployed script.

// Which data types exist, and what does a real data point look like?
// Answers three things at once: the correct data type IDs (the kit's
// `calories-burned` and `resting-heart-rate` are rejected as invalid), the
// correct filter member names, and the right key names for findNums_.
function debugTypes() {
  const svc = healthService_();
  const raw = (url) => {
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + svc.getAccessToken() },
      muteHttpExceptions: true });
    return { code: res.getResponseCode(), body: res.getContentText() };
  };

  const list = raw('https://health.googleapis.com/v4/users/me/dataTypes?pageSize=200');
  Logger.log('==== dataTypes list: HTTP %s ====', list.code);
  let ids = [];
  try {
    const j = JSON.parse(list.body);
    const arr = j.dataTypes || j.dataTypeList || j.types || [];
    ids = arr.map(d => d.dataTypeId || d.id || d.name).filter(String);
  } catch (e) {}
  Logger.log(ids.length ? ids.join('\n') : list.body.slice(0, 4000));

  const s = raw(API + 'steps/dataPoints?pageSize=2');
  Logger.log('==== steps sample: HTTP %s ====\n%s', s.code, s.body.slice(0, 3000));
}

// What scopes is a token actually carrying, and what does the API object to?
// This is what surfaced DISALLOWED_OAUTH_SCOPES; pullDay_ truncates errors to
// 200 chars, which hid the details array naming the offending scopes.
function debugScopes() {
  const token = ScriptApp.getOAuthToken();
  const info = UrlFetchApp.fetch(
    'https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' +
    encodeURIComponent(token), { muteHttpExceptions: true });
  let scopes = '(unparseable)';
  try { scopes = JSON.parse(info.getContentText()).scope; } catch (e) {}
  Logger.log('GRANTED SCOPES:\n' + String(scopes).split(' ').join('\n'));

  const res = UrlFetchApp.fetch(API + 'steps/dataPoints?pageSize=1', {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  Logger.log('HTTP %s\n%s', res.getResponseCode(), res.getContentText());
}

// Are the OAuth client credentials actually stored, and under the right keys?
// Logs the client id in full (public by design) and the secret's length only.
function debugClient() {
  const p = PropertiesService.getScriptProperties();
  Logger.log('PROPERTY KEYS: %s', JSON.stringify(p.getKeys()));
  const id = p.getProperty('CLIENT_ID');
  const sec = p.getProperty('CLIENT_SECRET');
  Logger.log('CLIENT_ID: %s', id === null ? '(MISSING)' : id);
  Logger.log('CLIENT_ID length: %s', id ? id.length : 0);
  Logger.log('CLIENT_SECRET: %s, length %s',
             sec === null ? '(MISSING)' : 'present', sec ? sec.length : 0);
}

// Is the day's burn total, or active-only? Fitbit shows one calories-burned
// number; this API splits it into active and basal, and basal may simply not
// be populated. Logs each side separately so a low total is attributable.
function debugBurn() {
  const date = today_();
  ['active', 'basal'].forEach(k => {
    const spec = TYPES[k];
    try {
      const d = apiGetDay_(spec, date);
      const sum = findNums_(d, ['kcal']).reduce((a, b) => a + b, 0);
      Logger.log('%s (%s): %s data points, %s kcal',
                 k, spec.path, (d.dataPoints || []).length, Math.round(sum));
    } catch (err) { Logger.log('%s (%s): ERROR %s', k, spec.path, err); }
  });
}
