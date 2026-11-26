import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCas } from '../core/cas'
import { linesFromItems, PdfPasswordError, pdfLines } from './pdfText'

// A made-up CAS, AES-256 encrypted with the password ABCDE1234F (scripts/make-cas-fixture.py).
const pdf = () => {
  const b = readFileSync(new URL('./fixtures/cas-sample.pdf', import.meta.url))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

describe('PDF text', () => {
  it('puts pieces on the same height into one line, left to right', () => {
    expect(
      linesFromItems([
        { str: 'NAV on 25-Nov-2026:', x: 190, y: 700, w: 60 },
        { str: 'Closing Unit Balance: 150.000', x: 40, y: 700.8, w: 100 },
        { str: 'Header', x: 40, y: 800, w: 20 },
        { str: ' ', x: 10, y: 600, w: 1 },
      ]),
    ).toEqual(['Header', 'Closing Unit Balance: 150.000 NAV on 25-Nov-2026:'])
  })

  it('asks for the password, refuses a wrong one, and reads the statement with the right one', async () => {
    await expect(pdfLines(pdf(), '')).rejects.toMatchObject({ wrong: false })
    const e = await pdfLines(pdf(), 'WRONG').catch((x) => x)
    expect(e).toBeInstanceOf(PdfPasswordError)
    expect(e.wrong).toBe(true)

    const lines = await pdfLines(pdf(), ' ABCDE1234F ')
    expect(lines).toContain('Closing Unit Balance: 150.000 NAV on 25-Nov-2026: INR 102.3456 Total Cost Value: 14,500.00')
    const s = parseCas(lines)
    expect(s.funds).toEqual([
      expect.objectContaining({ isin: 'INF000A01AB1', name: 'Example Flexi Cap Fund - Direct Plan - Growth', units: '150', navPaise: 10235, costPaise: 1_450_000, valuePaise: 1_535_184 }),
    ])
  })
})
