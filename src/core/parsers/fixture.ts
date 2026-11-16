/**
 * Reads an email saved as text: header lines (From:, Subject:, Date:), a line `---`, then the body.
 * Used by tests for both the committed synthetic fixtures and the local-only real samples.
 */
import type { EmailInput } from './types'

export function readFixture(raw: string): EmailInput {
  const sep = raw.indexOf('\n---\n')
  if (sep < 0) throw new Error('Fixture needs a --- line between headers and body')
  const head = raw.slice(0, sep)
  const header = (name: string) => new RegExp(`^${name}:\\s*(.*)$`, 'mi').exec(head)?.[1]?.trim() ?? ''
  return {
    from: header('From'),
    subject: header('Subject'),
    receivedAt: header('Date'),
    // Drop the [NOTE: ...] lines the sample collector added.
    text: raw.slice(sep + 5).replace(/^\[NOTE:[^\]]*\]\s*/gm, ''),
  }
}
