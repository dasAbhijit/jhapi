/**
 * Everything the Apps Script needs from the app's core, bundled by scripts/build-cloud.mjs into the
 * global `JhapiCore` at the top of cloud/Code.gs. One tested copy of the parsers and sheet layout
 * serves both the app and the script.
 */
export { parseEmail, findSender, SENDERS } from '../core/parsers/index'
export { checkSender } from '../core/dkim'
export { txnFromParsed, statementFromParsed, isDuplicate, mergeById, accountLabel, ruleCategory, pairTransfers, enrichFromReceipts } from '../core/records'
export {
  TXN_TAB, REVIEW_TAB, STATEMENT_TAB, LOG_TAB, RULES_TAB, TXN_HEADERS, REVIEW_HEADERS, STATEMENT_HEADERS, RULES_HEADERS, TEXT_COLUMNS,
  txnToRow, rowToTxn, reviewToRow, rowToReview, statementToRow, rowToStatement, ruleToRow, rowToRule,
  HOLDINGS_TAB, HOLDING_HEADERS, holdingToRow, rowToHolding,
} from '../core/sheetRows'
export { HOLDING_TYPES } from '../core/holdings'
