/**
 * Runs the parsers over the owner's REAL emails in the git-ignored samples/ folder.
 * Skipped when that folder is absent (CI, fresh clones). Prints no amounts, names or numbers:
 * only file names, template names and pass/fail.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFixture } from './fixture'
import { parseEmail } from './index'

const ROOT = join(__dirname, '../../../samples/raw')
const BANKS = ['axis', 'icici', 'sbi', 'dbs', 'phonepe', 'amazonpay', 'cred']

/** What each sample file should produce, by file name. Anything not listed should be a transaction. */
function expected(file: string): 'txn' | 'statement' | 'ignore' | 'unparsed' {
  if (/cc-statement/.test(file)) return 'statement'
  if (/account-statement|acct-statement|autopay-reminder|cc-si-upcoming|bill-payment|cc-bill-payment|autopay-complete|cc-bill-summary/.test(file)) {
    return file.startsWith('phonepe/bill-payment') ? 'txn' : 'ignore'
  }
  if (/refund-giftcard/.test(file)) return 'unparsed'
  if (/forex-card/.test(file)) return 'ignore'
  return 'txn'
}

const files = existsSync(ROOT)
  ? BANKS.flatMap((b) => (existsSync(join(ROOT, b)) ? readdirSync(join(ROOT, b)).filter((f) => f.endsWith('.txt')).map((f) => `${b}/${f}`) : []))
  : []

describe.skipIf(files.length === 0)('real samples (local only)', () => {
  it.each(files)('%s', (file) => {
    const r = parseEmail(readFixture(readFileSync(join(ROOT, file), 'utf8')))
    const want = expected(file)
    // Show only the kind and template or reason on failure, never the email's values.
    const got = r.kind === 'txn' || r.kind === 'statement' ? `${r.kind}:${r.template}` : `${r.kind}:${r.reason}`
    expect(got.startsWith(want), `${file} → ${got}`).toBe(true)
  })
})
