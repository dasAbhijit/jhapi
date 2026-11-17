/**
 * Talks to Jhapi's own Apps Script web app (the one in Jhapi's Google Sheet).
 * The body is sent as text/plain so the browser makes a simple request with no CORS preflight, which
 * Apps Script cannot answer; fetch then follows Google's redirect to the reply.
 */
import type { Alias } from '../core/aliases'
import type { Holding } from '../core/holdings'
import type { Snapshot as NetWorthPoint } from '../core/networth'
import type { Goal } from '../core/goalPlan'
import type { ReviewItem, Rule, Statement, Txn } from '../core/records'

export interface SheetConfig {
  url: string
  token: string
}

export interface PullResult {
  ok: true
  version: number
  lastInboxRun: string
  transactions: Txn[]
  statements: Statement[]
  review: ReviewItem[]
  rules?: Rule[]
  names?: Alias[]
  holdings?: Holding[]
  netWorth?: NetWorthPoint[]
  goals?: Goal[]
  problems: string[]
  rejected?: string[]
}

export class SheetError extends Error {
  readonly code: 'auth' | 'network' | 'server' | 'setup'
  constructor(message: string, code: SheetError['code']) {
    super(message)
    this.code = code
  }
}

export type Transport = (url: string, body: string, timeoutMs: number) => Promise<string>

export const fetchTransport: Transport = async (url, body, timeoutMs) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      body,
      redirect: 'follow',
      credentials: 'omit',
      signal: ctl.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    })
    if (!res.ok) throw new SheetError(`The sheet answered with error ${res.status}.`, 'server')
    return await res.text()
  } catch (e) {
    if (e instanceof SheetError) throw e
    throw new SheetError(ctl.signal.aborted ? 'The sheet took too long to answer.' : 'Could not reach the sheet. Check the connection.', 'network')
  } finally {
    clearTimeout(timer)
  }
}

/** Accepts only a Google Apps Script web app address, so the code is never sent anywhere else. */
export function validateUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return 'That is not a web address.'
  }
  if (u.protocol !== 'https:' || u.hostname !== 'script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(u.pathname)) {
    return 'Use the web app URL from Deploy > Manage deployments. It looks like https://script.google.com/macros/s/…/exec'
  }
  return null
}

export class SheetClient {
  private readonly config: SheetConfig
  private readonly transport: Transport
  constructor(config: SheetConfig, transport: Transport = fetchTransport) {
    this.config = config
    this.transport = transport
  }

  private async call<T>(action: string, extra: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<T> {
    const text = await this.transport(this.config.url, JSON.stringify({ token: this.config.token, action, ...extra }), timeoutMs)
    let reply: { ok: boolean; error?: string; code?: string }
    try {
      reply = JSON.parse(text)
    } catch {
      throw new SheetError('The sheet sent back something unexpected. Is the web app deployed with access for Anyone?', 'server')
    }
    if (!reply.ok) {
      const code = reply.code === 'auth' ? 'auth' : /not set up/i.test(reply.error ?? '') ? 'setup' : 'server'
      throw new SheetError(reply.error ?? 'The sheet refused the request.', code)
    }
    return reply as T
  }

  ping(): Promise<{ ok: true; spreadsheet: string }> {
    return this.call('ping')
  }

  pull(): Promise<PullResult> {
    return this.call('pull')
  }

  push(changes: { transactions?: Txn[]; review?: Pick<ReviewItem, 'id' | 'resolved' | 'updatedAt'>[]; rules?: Rule[]; names?: Alias[]; holdings?: Holding[]; goals?: Goal[] }, device: string): Promise<PullResult> {
    return this.call('push', { ...changes, device })
  }

  /** Asks the script to fetch prices and save today's net worth, then returns everything. */
  refreshPrices(): Promise<PullResult> {
    return this.call('refreshPrices', {}, 120_000)
  }

  /** Asks the script to read bank emails now, then returns everything. Can take a minute. */
  readInbox(): Promise<PullResult> {
    return this.call('readInbox', {}, 120_000)
  }
}
