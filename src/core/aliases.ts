/**
 * Display names for payees and payers. Banks write names their own way ("BUNDL TECHNOLOGIES PVT LTD",
 * "swiggy.upi@axisbank"); the owner can show them as something shorter ("Swiggy"). The bank's name is
 * never changed in the Transactions tab: the alias lives in the Names tab and is applied when showing.
 *
 * Several bank names may share one display name; they then count as one sender for "change all from
 * this sender". Bundled into the Apps Script too, so keep it free of browser and Node APIs.
 */
export interface Alias {
  id: string
  /** The name as the bank wrote it. Matched ignoring case and extra spaces. */
  name: string
  /** What the app shows instead. */
  showAs: string
  updatedAt: string
  deleted: boolean
}

export function normName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export type AliasMap = Map<string, Alias>

/** Live aliases by normalised bank name. If two rows name the same bank name, the newer one wins. */
export function aliasMap(aliases: Alias[]): AliasMap {
  const m: AliasMap = new Map()
  for (const a of aliases) {
    const key = normName(a.name)
    if (a.deleted || !key || !a.showAs.trim()) continue
    const cur = m.get(key)
    if (!cur || a.updatedAt > cur.updatedAt) m.set(key, a)
  }
  return m
}

export interface ShownName {
  /** What to show in large type. */
  title: string
  /** The bank's own name, when an alias replaced it; null otherwise. */
  raw: string | null
}

export function shownName(counterparty: string, map: AliasMap): ShownName {
  const a = map.get(normName(counterparty))
  if (!a) return { title: counterparty, raw: null }
  const title = a.showAs.trim()
  return { title, raw: normName(title) === normName(counterparty) ? null : counterparty }
}

/** One key per sender: the display name if there is one, else the bank's name. Empty names have no sender. */
export function senderKey(counterparty: string, map: AliasMap): string {
  return normName(shownName(counterparty, map).title)
}

/** The alias row to save when the owner sets (or clears) the display name of `counterparty`. */
export function aliasFor(counterparty: string, showAs: string, aliases: Alias[], newId: () => string): Alias | null {
  const name = counterparty.trim()
  if (!name) return null
  const want = showAs.trim()
  const cur = aliasMap(aliases).get(normName(name))
  if (cur) {
    if (cur.showAs.trim() === want) return null
    // Tidying only the capitals ("SWIGGY" → "Swiggy") is a display name too.
    return want && want !== name ? { ...cur, showAs: want } : { ...cur, deleted: true }
  }
  if (!want || want === name) return null
  return { id: newId(), name, showAs: want, updatedAt: '', deleted: false }
}
