/**
 * Jhapi: the script that lives in Jhapi's own Google Sheet (and nowhere else).
 *
 * 1. Every 10 minutes `readInbox` reads new bank alert emails (read-only), checks each sender's
 *    DKIM signature, parses the email with JhapiCore (the app's own tested parsers, bundled above),
 *    and adds rows to the Transactions, Statements and Review tabs.
 * 2. As a web app it answers the Jhapi app: `pull` returns every row, `push` merges the app's
 *    changes row by row (the newer edit wins). Every call needs the secret code in Script properties.
 * 3. `onEdit` stamps rows edited by hand with an ID and an Updated time, so edits made in the sheet
 *    flow back to the app.
 *
 * Setup: docs/admin/setup.md in the Jhapi repo. Nothing here is shared with any other app or sheet.
 */

/* oxlint-disable no-unused-vars -- Apps Script calls onOpen, setup, doGet, doPost, onEdit and readInbox by name. */

var J = JhapiCore;
var TOKEN_PROP = 'JHAPI_TOKEN';
var VERSION_PROP = 'JHAPI_VERSION';
var LAST_RUN_PROP = 'JHAPI_LAST_RUN';
var BACKFILL_DAYS_PROP = 'JHAPI_BACKFILL_DAYS';
var DEFAULT_BACKFILL_DAYS = 60;
var MAX_EMAILS_PER_RUN = 200;
var MAX_THREADS = 500;
var MAX_BODY_CHARS = 5 * 1024 * 1024;
var MAX_RECORDS_PER_PUSH = 5000;
var MAX_REVIEW_TEXT = 4000;
var MAX_LOG_ROWS = 500;
var TIDY_DAYS = 45; // how far back transfer pairing and receipt matching look after each email run

var TABS = [
  { name: J.TXN_TAB, headers: J.TXN_HEADERS },
  { name: J.STATEMENT_TAB, headers: J.STATEMENT_HEADERS },
  { name: J.REVIEW_TAB, headers: J.REVIEW_HEADERS },
  { name: J.RULES_TAB, headers: J.RULES_HEADERS },
  { name: J.LOG_TAB, headers: ['Time', 'Event'] },
];

// ---------- menu and setup ----------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Jhapi')
    .addItem('Set up / show secret code', 'setup')
    .addItem('Read bank emails now', 'readInbox')
    .addToUi();
}

/** Creates the tabs, the secret code and the 10-minute trigger. Safe to run again. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty(TOKEN_PROP);
  if (!token) {
    token = newToken_();
    props.setProperty(TOKEN_PROP, token);
  }
  ensureTabs_();
  var hasTrigger = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'readInbox';
  });
  if (!hasTrigger) ScriptApp.newTrigger('readInbox').timeBased().everyMinutes(10).create();
  log_('Set up: tabs ready, bank emails checked every 10 minutes.');
  var msg =
    'Secret code for the Jhapi app:\n\n' + token +
    '\n\nNext: Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.' +
    ' Then paste the web app URL and this code into Jhapi > Settings.';
  try {
    SpreadsheetApp.getUi().alert('Jhapi is set up', msg, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (_noUi) {
    Logger.log(msg); // run from the editor: the code is in the execution log
  }
  return token;
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function ensureTabs_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  TABS.forEach(function (tab) {
    var sheet = ss.getSheetByName(tab.name) || ss.insertSheet(tab.name);
    var width = tab.headers.length;
    if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    var current = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, width).getValues()[0] : [];
    var missing = tab.headers.some(function (h, i) { return current[i] !== h; });
    if (missing) {
      if (sheet.getLastRow() > 1 && current.join('') !== '') {
        throw new Error('The ' + tab.name + ' tab has different columns. Rename it and run Set up again.');
      }
      sheet.getRange(1, 1, 1, width).setValues([tab.headers.slice()]);
    }
    sheet.getRange(1, 1, 1, width).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });
}

// ---------- web app ----------

function doGet() {
  return reply_({ ok: true, app: 'Jhapi sync', v: 1 });
}

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw) return reply_({ ok: false, error: 'Empty request.' });
    if (raw.length > MAX_BODY_CHARS) return reply_({ ok: false, error: 'The request is too large.' });
    var body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply_({ ok: false, error: 'Unknown action.' });
    var expected = PropertiesService.getScriptProperties().getProperty(TOKEN_PROP);
    if (!expected) return reply_({ ok: false, error: 'The sheet is not set up yet: run Jhapi > Set up in the sheet.' });
    if (!sameText_(String(body.token || ''), expected)) return reply_({ ok: false, code: 'auth', error: 'Wrong secret code.' });
    if (body.action === 'ping') return reply_({ ok: true, spreadsheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
    if (body.action === 'pull') return reply_(withLock_(pull_));
    if (body.action === 'push') {
      validatePush_(body);
      return reply_(withLock_(function () { return push_(body); }));
    }
    if (body.action === 'readInbox') {
      readInbox();
      return reply_(withLock_(pull_));
    }
    return reply_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    return reply_({ ok: false, error: String((err && err.message) || err) });
  }
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Constant-time comparison so the code cannot be guessed one character at a time. */
function sameText_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function nowIso_() {
  return new Date(nowMs_()).toISOString();
}

function nowMs_() {
  return Date.now();
}

function version_() {
  return parseInt(PropertiesService.getScriptProperties().getProperty(VERSION_PROP) || '0', 10);
}

function bumpVersion_() {
  var v = version_() + 1;
  PropertiesService.getScriptProperties().setProperty(VERSION_PROP, String(v));
  return v;
}

// ---------- reading and writing tabs ----------

/** Header names and data rows of a tab. Missing tabs read as empty. */
function readTab_(name) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 1) return { sheet: sheet, headers: [], rows: [] };
  var values = sheet.getDataRange().getValues();
  return { sheet: sheet, headers: values[0].map(String), rows: values.slice(1) };
}

/** Format text columns as plain text first, so Sheets keeps dates, times and IDs exactly as written. */
function writeRows_(sheet, tabName, headers, startRow, rows) {
  if (rows.length === 0) return;
  var needed = startRow + rows.length - 1;
  if (sheet.getMaxRows() < needed) sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  (J.TEXT_COLUMNS[tabName] || []).forEach(function (h) {
    var col = headers.indexOf(h);
    if (col >= 0) sheet.getRange(startRow, col + 1, rows.length, 1).setNumberFormat('@');
  });
  sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
}

function appendRows_(tabName, rows) {
  if (rows.length === 0) return;
  ensureTabs_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tabName);
  var headers = TABS.filter(function (t) { return t.name === tabName; })[0].headers.slice();
  writeRows_(sheet, tabName, headers, sheet.getLastRow() + 1, rows);
}

function log_(event) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(J.LOG_TAB) || ss.insertSheet(J.LOG_TAB);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, 2).setValues([['Time', 'Event']]);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2).setValues([[nowIso_(), String(event).slice(0, 1000)]]);
  if (sheet.getLastRow() > MAX_LOG_ROWS + 50) sheet.deleteRows(2, sheet.getLastRow() - MAX_LOG_ROWS - 1);
}

/**
 * Every transaction, with rows typed by hand tidied up: an ID and an Updated time are added, and the
 * row is rewritten in the standard layout. Rows that cannot be read are reported, not changed.
 */
function loadTxns_() {
  var tab = readTab_(J.TXN_TAB);
  var txns = [];
  var problems = [];
  tab.rows.forEach(function (row, i) {
    var r = J.rowToTxn(row, tab.headers);
    if (!r.txn) {
      if (r.problem) problems.push('Transactions row ' + (i + 2) + ': ' + r.problem);
      return;
    }
    var t = r.txn;
    var fix = false;
    if (!t.id) { t.id = Utilities.getUuid(); fix = true; }
    if (!t.updatedAt) { t.updatedAt = nowIso_(); fix = true; }
    if (fix) writeRows_(tab.sheet, J.TXN_TAB, tab.headers, i + 2, [J.txnToRow(t)]);
    txns.push({ txn: t, row: i + 2 });
  });
  return { tab: tab, items: txns, problems: problems };
}

function loadReview_() {
  var tab = readTab_(J.REVIEW_TAB);
  var items = [];
  tab.rows.forEach(function (row, i) {
    var r = J.rowToReview(row, tab.headers);
    if (r) items.push({ item: r, row: i + 2 });
  });
  return { tab: tab, items: items };
}

function loadStatements_() {
  var tab = readTab_(J.STATEMENT_TAB);
  var out = [];
  tab.rows.forEach(function (row) {
    var s = J.rowToStatement(row, tab.headers);
    if (s) out.push(s);
  });
  return out;
}

/** The owner's category rules. Rows typed by hand get an ID and an Updated time. */
function loadRules_() {
  var tab = readTab_(J.RULES_TAB);
  var items = [];
  tab.rows.forEach(function (row, i) {
    var r = J.rowToRule(row, tab.headers);
    if (!r) return;
    var fix = false;
    if (!r.id) { r.id = Utilities.getUuid(); fix = true; }
    if (!r.updatedAt) { r.updatedAt = nowIso_(); fix = true; }
    if (fix) writeRows_(tab.sheet, J.RULES_TAB, tab.headers, i + 2, [J.ruleToRow(r)]);
    items.push({ rule: r, row: i + 2 });
  });
  return { tab: tab, items: items };
}

function pull_() {
  var t = loadTxns_();
  var props = PropertiesService.getScriptProperties();
  return {
    ok: true,
    version: version_(),
    lastInboxRun: props.getProperty(LAST_RUN_PROP) || '',
    transactions: t.items.map(function (x) { return x.txn; }),
    statements: loadStatements_(),
    review: loadReview_().items.map(function (x) { return x.item; }),
    rules: loadRules_().items.map(function (x) { return x.rule; }),
    problems: t.problems,
  };
}

// ---------- push from the app ----------

var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
var ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Checks the whole request before anything is written, so a bad request changes nothing. */
function validatePush_(body) {
  var txns = body.transactions || [];
  var review = body.review || [];
  var rules = body.rules || [];
  if (!Array.isArray(txns) || !Array.isArray(review) || !Array.isArray(rules)) throw new Error('Bad request.');
  if (txns.length + review.length + rules.length > MAX_RECORDS_PER_PUSH) throw new Error('Too many changes in one request.');
  rules.forEach(function (r, i) {
    var ok = r && typeof r.id === 'string' && r.id && r.id.length <= 100 &&
      typeof r.contains === 'string' && r.contains.trim() && r.contains.length <= 200 &&
      typeof r.category === 'string' && r.category.trim() && r.category.length <= 60 &&
      typeof r.deleted === 'boolean' && ISO_TIME.test(String(r.updatedAt));
    if (!ok) throw new Error('Rule ' + (i + 1) + ': bad record.');
  });
  txns.forEach(function (t, i) {
    var where = 'Transaction ' + (i + 1) + ': ';
    if (!t || typeof t !== 'object') throw new Error(where + 'not a record.');
    if (typeof t.id !== 'string' || !t.id || t.id.length > 100) throw new Error(where + 'bad id.');
    if (!ISO_DATE.test(String(t.date))) throw new Error(where + 'bad date.');
    if (typeof t.amountPaise !== 'number' || t.amountPaise <= 0 || t.amountPaise % 1 !== 0 || t.amountPaise > 1e13) throw new Error(where + 'bad amount.');
    if (t.direction !== 'debit' && t.direction !== 'credit') throw new Error(where + 'bad type.');
    if (!ISO_TIME.test(String(t.updatedAt))) throw new Error(where + 'bad updated time.');
    ['time', 'account', 'counterparty', 'category', 'channel', 'reference', 'note', 'emailId', 'template'].forEach(function (k) {
      if (typeof t[k] !== 'string' || t[k].length > 2000) throw new Error(where + 'bad ' + k + '.');
    });
  });
  review.forEach(function (r, i) {
    if (!r || typeof r.id !== 'string' || typeof r.resolved !== 'boolean' || !ISO_TIME.test(String(r.updatedAt))) {
      throw new Error('Review item ' + (i + 1) + ': bad record.');
    }
  });
}

function push_(body) {
  ensureTabs_();
  var loaded = loadTxns_();
  var byId = {};
  loaded.items.forEach(function (x) { byId[x.txn.id] = x; });
  var rejected = [];
  var appended = [];
  var changed = 0;
  (body.transactions || []).forEach(function (t) {
    var rec = {
      id: t.id, date: t.date, time: t.time, account: t.account, direction: t.direction, amountPaise: t.amountPaise,
      counterparty: t.counterparty, category: t.category, channel: t.channel, reference: t.reference,
      balancePaise: typeof t.balancePaise === 'number' ? t.balancePaise : null,
      status: ['verified', 'manual', 'receipt', 'review', 'ignored'].indexOf(t.status) >= 0 ? t.status : 'manual',
      source: ['email', 'app', 'sheet'].indexOf(t.source) >= 0 ? t.source : 'app',
      note: t.note, emailId: t.emailId, template: t.template, updatedAt: t.updatedAt, deleted: t.deleted === true,
    };
    var cur = byId[rec.id];
    if (cur && cur.txn.updatedAt > rec.updatedAt) {
      rejected.push(rec.id); // edited in the sheet more recently: the sheet wins
      return;
    }
    if (cur && cur.txn.updatedAt === rec.updatedAt) return; // nothing new
    if (cur) {
      writeRows_(loaded.tab.sheet, J.TXN_TAB, loaded.tab.headers, cur.row, [J.txnToRow(rec)]);
      cur.txn = rec;
    } else {
      appended.push(J.txnToRow(rec));
      byId[rec.id] = { txn: rec, row: -1 };
    }
    changed++;
  });
  appendRows_(J.TXN_TAB, appended);

  var review = loadReview_();
  (body.review || []).forEach(function (r) {
    review.items.forEach(function (x) {
      if (x.item.id === r.id && r.updatedAt > x.item.updatedAt) {
        x.item.resolved = r.resolved;
        x.item.updatedAt = r.updatedAt;
        writeRows_(review.tab.sheet, J.REVIEW_TAB, review.tab.headers, x.row, [J.reviewToRow(x.item)]);
        changed++;
      }
    });
  });

  var ruleState = loadRules_();
  var rulesById = {};
  ruleState.items.forEach(function (x) { rulesById[x.rule.id] = x; });
  var newRules = [];
  (body.rules || []).forEach(function (r) {
    var rec = { id: r.id, contains: r.contains.trim(), category: r.category.trim(), updatedAt: r.updatedAt, deleted: r.deleted };
    var cur = rulesById[rec.id];
    if (cur && cur.rule.updatedAt > rec.updatedAt) { rejected.push(rec.id); return; }
    if (cur && cur.rule.updatedAt === rec.updatedAt) return;
    if (cur) writeRows_(ruleState.tab.sheet, J.RULES_TAB, ruleState.tab.headers, cur.row, [J.ruleToRow(rec)]);
    else newRules.push(J.ruleToRow(rec));
    changed++;
  });
  appendRows_(J.RULES_TAB, newRules);

  if (changed > 0) {
    bumpVersion_();
    log_('App saved ' + changed + ' change(s)' + (body.device ? ' from ' + String(body.device).slice(0, 60) : '') + '.');
  }
  var result = pull_();
  result.rejected = rejected;
  return result;
}

// ---------- hand edits in the sheet ----------

/** Simple trigger: stamp edited rows so the app picks up the change. */
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  var name = sheet.getName();
  if (name !== J.TXN_TAB && name !== J.REVIEW_TAB && name !== J.STATEMENT_TAB && name !== J.RULES_TAB) return;
  var first = Math.max(2, e.range.getRow());
  var last = e.range.getRow() + e.range.getNumRows() - 1;
  if (last < first) return;
  var width = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, width).getValues()[0].map(String);
  var idCol = headers.indexOf('ID');
  var updCol = headers.indexOf('Updated');
  if (updCol < 0) return;
  var editedCol = e.range.getColumn() - 1;
  if (e.range.getNumColumns() === 1 && editedCol === updCol) return; // the stamp itself
  var rows = sheet.getRange(first, 1, last - first + 1, width).getValues();
  var now = nowIso_();
  rows.forEach(function (row, i) {
    if (row.join('') === '') return;
    if (idCol >= 0 && !row[idCol]) sheet.getRange(first + i, idCol + 1).setNumberFormat('@').setValue(Utilities.getUuid());
    sheet.getRange(first + i, updCol + 1).setNumberFormat('@').setValue(now);
  });
}

// ---------- reading bank emails ----------

/** Runs every 10 minutes. Reads only allow-listed bank senders; never changes or labels any email. */
function readInbox() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'Another run is in progress.' };
  try {
    return readInboxLocked_();
  } finally {
    lock.releaseLock();
  }
}

function readInboxLocked_() {
  ensureTabs_();
  var props = PropertiesService.getScriptProperties();
  var now = nowMs_();
  var lastRun = Date.parse(props.getProperty(LAST_RUN_PROP) || '');
  var backfill = parseInt(props.getProperty(BACKFILL_DAYS_PROP) || String(DEFAULT_BACKFILL_DAYS), 10);
  // Look back a day past the last run: Gmail search is by day, and late deliveries happen.
  var afterMs = isFinite(lastRun) ? lastRun - 24 * 3600 * 1000 : now - backfill * 24 * 3600 * 1000;

  var addresses = J.SENDERS.map(function (s) { return s.match; }).filter(function (m) { return m.charAt(0) !== '@'; });
  var query = 'from:(' + addresses.join(' OR ') + ') after:' + Math.floor(afterMs / 1000);

  var messages = [];
  for (var start = 0; start < MAX_THREADS; start += 100) {
    var threads = GmailApp.search(query, start, 100);
    threads.forEach(function (th) {
      // Gmail groups alerts with the same subject into one thread: read every message.
      th.getMessages().forEach(function (m) {
        if (m.getDate().getTime() >= afterMs) messages.push(m);
      });
    });
    if (threads.length < 100) break;
  }
  messages.sort(function (a, b) { return a.getDate().getTime() - b.getDate().getTime(); });

  var txnState = loadTxns_();
  var existing = txnState.items.map(function (x) { return x.txn; });
  var known = {};
  existing.forEach(function (t) { if (t.emailId) known[t.emailId] = true; });
  loadReview_().items.forEach(function (x) { if (x.item.emailId) known[x.item.emailId] = true; });
  var statements = loadStatements_();
  statements.forEach(function (s) { if (s.emailId) known[s.emailId] = true; });
  var rules = loadRules_().items.map(function (x) { return x.rule; });

  var newTxns = [];
  var newStatements = [];
  var newReview = [];
  var counts = { txn: 0, receipt: 0, statement: 0, review: 0, blocked: 0, ignored: 0, duplicate: 0 };
  var processed = 0;
  var cursor = now;

  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var emailId = m.getId();
    if (known[emailId]) continue;
    if (processed >= MAX_EMAILS_PER_RUN) {
      cursor = m.getDate().getTime(); // continue from here next run
      break;
    }
    processed++;
    known[emailId] = true;
    var from = m.getFrom();
    var sender = J.findSender(from);
    if (!sender) continue;
    var stamp = nowIso_();
    var verdict = J.checkSender(m.getRawContent(), from, sender.dkimDomain);
    if (!verdict.ok) {
      newReview.push(reviewRow_(m, emailId, from, 'blocked', verdict.reason, stamp));
      counts.blocked++;
      continue;
    }
    var text = m.getPlainBody() || stripHtml_(m.getBody());
    var result = J.parseEmail({ from: from, subject: m.getSubject(), receivedAt: m.getDate().toISOString(), text: text });
    if (result.kind === 'txn') {
      var t = J.txnFromParsed(result, { id: Utilities.getUuid(), emailId: emailId, now: stamp });
      var ruled = J.ruleCategory(t.counterparty, rules);
      if (ruled && t.category !== 'Transfer') t.category = ruled;
      if (J.isDuplicate(t, existing)) { counts.duplicate++; continue; }
      existing.push(t);
      newTxns.push(J.txnToRow(t));
      if (t.status === 'receipt') counts.receipt++;
      else counts.txn++;
    } else if (result.kind === 'statement') {
      var s = J.statementFromParsed(result, { id: Utilities.getUuid(), emailId: emailId, now: stamp });
      var dup = statements.some(function (x) { return x.account === s.account && x.dueDate === s.dueDate; });
      if (!dup) { statements.push(s); newStatements.push(J.statementToRow(s)); counts.statement++; }
    } else if (result.kind === 'unparsed') {
      newReview.push(reviewRow_(m, emailId, from, 'unparsed', result.reason, stamp, text));
      counts.review++;
    } else {
      counts.ignored++;
    }
  }

  appendRows_(J.TXN_TAB, newTxns);
  appendRows_(J.STATEMENT_TAB, newStatements);
  appendRows_(J.REVIEW_TAB, newReview);
  props.setProperty(LAST_RUN_PROP, new Date(cursor).toISOString());
  var tidied = newTxns.length > 0 ? tidyRecent_() : 0;
  var added = newTxns.length + newStatements.length + newReview.length + tidied;
  if (added > 0) {
    bumpVersion_();
    log_(
      'Bank emails: ' + counts.txn + ' transaction(s), ' + counts.receipt + ' receipt(s), ' + counts.statement +
      ' statement(s), ' + counts.review + ' to review, ' + counts.blocked + ' blocked, ' + counts.duplicate + ' duplicate(s)' +
      (tidied ? ', ' + tidied + ' row(s) tagged as transfers or improved from receipts.' : '.')
    );
  }
  return { ok: true, processed: processed, counts: counts };
}

/**
 * After new emails: tag transfers between the owner's own accounts, and take payee and category from
 * receipts, over the last TIDY_DAYS days. Returns how many rows changed.
 */
function tidyRecent_() {
  var state = loadTxns_();
  var since = new Date(nowMs_() - TIDY_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
  var recent = state.items.filter(function (x) { return x.txn.date >= since; });
  var txns = recent.map(function (x) { return x.txn; });
  var updates = J.pairTransfers(txns).concat(J.enrichFromReceipts(txns));
  var byId = {};
  recent.forEach(function (x) { byId[x.txn.id] = x; });
  var stamp = nowIso_();
  var changed = {};
  updates.forEach(function (u) {
    var x = byId[u.id];
    if (!x) return;
    if (u.category !== undefined) x.txn.category = u.category;
    if (u.counterparty !== undefined) x.txn.counterparty = u.counterparty;
    if (u.note !== undefined) x.txn.note = u.note;
    x.txn.updatedAt = stamp;
    changed[u.id] = x;
  });
  Object.keys(changed).forEach(function (id) {
    var x = changed[id];
    writeRows_(state.tab.sheet, J.TXN_TAB, state.tab.headers, x.row, [J.txnToRow(x.txn)]);
  });
  return Object.keys(changed).length;
}

function reviewRow_(m, emailId, from, status, reason, stamp, text) {
  return J.reviewToRow({
    id: Utilities.getUuid(),
    receivedAt: m.getDate().toISOString(),
    from: from,
    subject: m.getSubject(),
    status: status,
    reason: reason,
    // Blocked emails are kept as subject only: their text may be a phishing attempt.
    text: status === 'blocked' ? '' : String(text || '').slice(0, MAX_REVIEW_TEXT),
    emailId: emailId,
    updatedAt: stamp,
    resolved: false,
  });
}

function stripHtml_(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
