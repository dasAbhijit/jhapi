/**
 * Encryption of what Jhapi keeps on this device, with a key that only the owner's passkey can give.
 *
 * - The passkey's PRF output (32 secret bytes the authenticator returns only after Face ID / Touch ID)
 *   goes through HKDF to an AES-GCM-256 key. The key is never stored and cannot be exported.
 * - Each stored value is encrypted on its own, with a fresh 12-byte IV, under `jhapi.vault.<name>`.
 * - LocalStore works with a synchronous KV, so VaultKV keeps the decrypted values in memory while
 *   the app is unlocked, and writes each change to localStorage encrypted, in order.
 * - The lock record (`jhapi.lock`) holds no secrets: the passkey's ID, the PRF salt, and a value
 *   encrypted with the key so a wrong passkey is caught before anything is decrypted.
 */
import type { KV } from './localStore'

export const LOCK_KEY = 'jhapi.lock'
export const VAULT_PREFIX = 'jhapi.vault.'
/** Plain keys LocalStore writes when the lock is off. */
export const PLAIN_KEYS = ['jhapi.sheet', 'jhapi.snapshot', 'jhapi.pending', 'jhapi.device']
const CHECK_TEXT = 'jhapi-vault-v1'

export interface LockRecord {
  v: 1
  /** base64url passkey credential ID. */
  credentialId: string
  /** base64 salt sent to the passkey's PRF. */
  salt: string
  /** CHECK_TEXT encrypted with the key. */
  check: string
  /** The passkey's name, e.g. "Jhapi on iPhone", so the owner can find it in Passwords. */
  label: string
}

const subtle = () => globalThis.crypto.subtle

export function toB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export const toB64url = (b: Uint8Array) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const fromB64url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n)
  globalThis.crypto.getRandomValues(b)
  return b
}

/** The AES key from the passkey's PRF output. Not extractable. */
export async function deriveKey(secret: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('jhapi device vault v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encrypt(key: CryptoKey, text: string): Promise<string> {
  const iv = randomBytes(12)
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return toB64(out)
}

/** Throws if the key is wrong or the value was changed. */
export async function decrypt(key: CryptoKey, stored: string): Promise<string> {
  const all = fromB64(stored)
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, key, all.slice(12))
  return new TextDecoder().decode(pt)
}

export function readLock(raw: KV): LockRecord | null {
  const s = raw.get(LOCK_KEY)
  if (!s) return null
  try {
    const r = JSON.parse(s) as LockRecord
    return r && r.v === 1 && typeof r.credentialId === 'string' && typeof r.salt === 'string' && typeof r.check === 'string' ? r : null
  } catch {
    return null
  }
}

export async function makeLock(key: CryptoKey, credentialId: string, salt: string, label: string): Promise<LockRecord> {
  return { v: 1, credentialId, salt, label, check: await encrypt(key, CHECK_TEXT) }
}

/** True if this key opens this lock. */
export async function keyFits(key: CryptoKey, lock: LockRecord): Promise<boolean> {
  try {
    return (await decrypt(key, lock.check)) === CHECK_TEXT
  } catch {
    return false
  }
}

function vaultNames(raw: KV): string[] {
  const names = new Set(PLAIN_KEYS)
  for (const k of raw.keys?.() ?? []) if (k.startsWith(VAULT_PREFIX)) names.add(k.slice(VAULT_PREFIX.length))
  return [...names]
}

/** A KV whose values live decrypted in memory and encrypted in `raw`. */
export class VaultKV implements KV {
  private readonly raw: KV
  private readonly key: CryptoKey
  private readonly values: Map<string, string>
  private chain: Promise<void> = Promise.resolve()
  /** Once frozen (turning the lock off), late writes from a sync still in flight are ignored. */
  frozen = false

  private constructor(raw: KV, key: CryptoKey, values: Map<string, string>) {
    this.raw = raw
    this.key = key
    this.values = values
  }

  /** Decrypts everything stored under the vault prefix. A value that will not decrypt is dropped. */
  static async open(raw: KV, key: CryptoKey): Promise<VaultKV> {
    const values = new Map<string, string>()
    for (const name of vaultNames(raw)) {
      const stored = raw.get(VAULT_PREFIX + name)
      if (!stored) continue
      try {
        values.set(name, await decrypt(key, stored))
      } catch {
        /* damaged or from another key: the sheet still has the data */
      }
    }
    return new VaultKV(raw, key, values)
  }

  get(k: string): string | null {
    return this.values.get(k) ?? null
  }
  set(k: string, v: string) {
    if (this.frozen) return
    this.values.set(k, v)
    this.chain = this.chain.then(async () => this.raw.set(VAULT_PREFIX + k, await encrypt(this.key, v))).catch(() => {})
  }
  remove(k: string) {
    if (this.frozen) return
    this.values.delete(k)
    this.chain = this.chain.then(() => this.raw.remove(VAULT_PREFIX + k))
  }
  /** Resolves when every write so far is in localStorage. */
  flush(): Promise<void> {
    return this.chain
  }
  entries(): [string, string][] {
    return [...this.values]
  }
}

/** Encrypts the plain values into the vault, then removes the plain copies. */
export async function sealPlain(raw: KV, key: CryptoKey, lock: LockRecord): Promise<void> {
  const plain: [string, string][] = []
  for (const k of PLAIN_KEYS) {
    const v = raw.get(k)
    if (v !== null) plain.push([k, v])
  }
  for (const [k, v] of plain) raw.set(VAULT_PREFIX + k, await encrypt(key, v))
  raw.set(LOCK_KEY, JSON.stringify(lock))
  for (const [k] of plain) raw.remove(k)
}

/** Writes the vault's values back as plain values, then removes the lock and the encrypted copies. */
export async function unsealToPlain(raw: KV, vault: VaultKV): Promise<void> {
  vault.frozen = true
  await vault.flush()
  for (const [k, v] of vault.entries()) raw.set(k, v)
  raw.remove(LOCK_KEY)
  for (const name of vaultNames(raw)) raw.remove(VAULT_PREFIX + name)
}

/** Forgets everything Jhapi keeps on this device, locked or not. The sheet keeps all data. */
export function wipeDevice(raw: KV) {
  for (const name of vaultNames(raw)) raw.remove(VAULT_PREFIX + name)
  for (const k of PLAIN_KEYS) raw.remove(k)
  raw.remove(LOCK_KEY)
}
