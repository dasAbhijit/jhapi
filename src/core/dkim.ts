/**
 * Checks that an email really comes from the bank, using the Authentication-Results header that
 * Gmail adds when it receives the email. Bundled into the Apps Script.
 *
 * Passes only if Gmail recorded `dkim=pass` for a signature from the bank's domain (or a subdomain of
 * it), AND the From address is at that domain. A look-alike sender, a forwarded copy or a spoofed
 * From all fail and go to Review as "Blocked", never into the books.
 */
import { senderAddress } from './parsers/text'

/** The header block of a raw RFC 822 message, with folded lines joined. */
export function headerBlock(raw: string): string {
  const end = raw.search(/\r?\n\r?\n/)
  return (end < 0 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, ' ')
}

function domainOf(addr: string): string {
  return addr.slice(addr.lastIndexOf('@') + 1).toLowerCase()
}

function within(domain: string, parent: string): boolean {
  return domain === parent || domain.endsWith(`.${parent}`)
}

export interface DkimVerdict {
  ok: boolean
  reason: string
}

export function checkSender(raw: string, from: string, dkimDomain: string): DkimVerdict {
  const parent = dkimDomain.toLowerCase()
  if (!within(domainOf(senderAddress(from)), parent)) return { ok: false, reason: `From address is not at ${parent}` }
  const lines = headerBlock(raw)
    .split(/\r?\n/)
    .filter((l) => /^(ARC-)?Authentication-Results:/i.test(l))
  if (lines.length === 0) return { ok: false, reason: 'No Authentication-Results header' }
  // Only trust results Gmail itself wrote (mx.google.com), not ones an attacker could put in the email.
  const google = lines.filter((l) => /^Authentication-Results:\s*mx\.google\.com/i.test(l))
  if (google.length === 0) return { ok: false, reason: 'No Gmail authentication result' }
  for (const l of google) {
    const re = /dkim=pass\b[^;]*?header\.(?:i=@?|d=)([A-Za-z0-9.-]+)/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(l))) {
      if (within(m[1].toLowerCase(), parent)) return { ok: true, reason: 'dkim=pass' }
    }
  }
  return { ok: false, reason: `Sender failed the bank signature check (no dkim=pass for ${parent})` }
}
