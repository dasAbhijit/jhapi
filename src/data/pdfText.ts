/**
 * Text out of a PDF, line by line, on the device (pdf.js). Used for CAS statements, which are
 * password-protected (usually the PAN). The file and the password never leave the device.
 * pdf.js is loaded only when a PDF is opened, so it does not slow down the rest of the app.
 */

export class PdfPasswordError extends Error {
  /** true when a password was given and it was wrong; false when one is needed. */
  readonly wrong: boolean
  constructor(wrong: boolean) {
    super(wrong ? 'That password does not open this PDF. For a CAS it is usually your PAN in capitals, or the password you chose when asking for it.' : 'This PDF needs its password.')
    this.wrong = wrong
  }
}

interface Item {
  str: string
  x: number
  y: number
  w: number
}

/** Groups text pieces into lines by their height on the page, left to right, top to bottom. */
export function linesFromItems(items: Item[]): string[] {
  const rows: { y: number; items: Item[] }[] = []
  for (const it of items) {
    if (!it.str.trim()) continue
    const row = rows.find((r) => Math.abs(r.y - it.y) <= 2)
    if (row) row.items.push(it)
    else rows.push({ y: it.y, items: [it] })
  }
  rows.sort((a, b) => b.y - a.y)
  return rows.map((r) => {
    r.items.sort((a, b) => a.x - b.x)
    let out = ''
    let end = -Infinity
    for (const it of r.items) {
      out += (out && it.x > end + 0.5 ? ' ' : '') + it.str
      end = it.x + it.w
    }
    return out.replace(/\s+/g, ' ').trim()
  })
}

export async function pdfLines(data: ArrayBuffer, password: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (typeof window !== 'undefined') {
    // In the browser the worker is a separate file Vite serves; Node (tests) finds its own.
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  }
  const task = pdfjs.getDocument({ data: new Uint8Array(data), password: password.trim() || undefined })
  let doc
  try {
    doc = await task.promise
  } catch (e) {
    void task.destroy()
    const err = e as { name?: string; code?: number }
    if (err?.name === 'PasswordException') throw new PdfPasswordError(err.code === 2)
    throw new Error('This file could not be opened as a PDF.', { cause: e })
  }
  try {
    const lines: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const items: Item[] = []
      for (const it of content.items) if ('str' in it) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width })
      lines.push(...linesFromItems(items))
      page.cleanup()
    }
    return lines
  } finally {
    void task.destroy()
  }
}
