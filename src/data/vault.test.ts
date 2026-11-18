import { describe, expect, it } from 'vitest'
import { LocalStore, memoryKV } from './localStore'
import { LOCK_KEY, VAULT_PREFIX, VaultKV, decrypt, deriveKey, encrypt, fromB64url, keyFits, makeLock, randomBytes, readLock, sealPlain, toB64url, unsealToPlain, wipeDevice } from './vault'

const secretA = new Uint8Array(32).fill(7)
const secretB = new Uint8Array(32).fill(9)

describe('device vault', () => {
  it('encrypts and decrypts with the key from the passkey secret, with a fresh IV each time', async () => {
    const key = await deriveKey(secretA)
    const a = await encrypt(key, 'SWIGGY ₹480')
    const b = await encrypt(key, 'SWIGGY ₹480')
    expect(a).not.toBe(b)
    expect(a).not.toContain('SWIGGY')
    expect(await decrypt(key, a)).toBe('SWIGGY ₹480')
    await expect(decrypt(await deriveKey(secretB), a)).rejects.toThrow()
  })

  it('tells a wrong passkey from the right one', async () => {
    const key = await deriveKey(secretA)
    const lock = await makeLock(key, 'cred', 'c2FsdA==', 'Jhapi on iPhone')
    expect(await keyFits(key, lock)).toBe(true)
    expect(await keyFits(await deriveKey(secretB), lock)).toBe(false)
  })

  it('base64url round-trips credential IDs', () => {
    const id = randomBytes(40)
    expect([...fromB64url(toB64url(id))]).toEqual([...id])
  })

  it('seals the plain copy, keeps it readable through VaultKV, and unseals it again', async () => {
    const raw = memoryKV()
    const plain = new LocalStore(raw)
    plain.setConfig({ url: 'https://script.google.com/macros/s/x/exec', token: 'a'.repeat(64) })
    raw.set('jhapi.snapshot', JSON.stringify({ transactions: [{ counterparty: 'SWIGGY' }] }))

    const key = await deriveKey(secretA)
    const lock = await makeLock(key, 'cred', 'c2FsdA==', 'Jhapi on iPhone')
    await sealPlain(raw, key, lock)

    // Nothing readable is left: no plain keys, and no plain text inside the stored values.
    expect(raw.get('jhapi.sheet')).toBeNull()
    expect(raw.get('jhapi.snapshot')).toBeNull()
    expect(readLock(raw)?.label).toBe('Jhapi on iPhone')
    for (const k of raw.keys!()) expect(raw.get(k)).not.toMatch(/SWIGGY|script\.google|aaaa/)

    const vault = await VaultKV.open(raw, key)
    expect(new LocalStore(vault).config()?.token).toBe('a'.repeat(64))

    // Writes go to storage encrypted.
    vault.set('jhapi.pending', JSON.stringify({ transactions: [{ counterparty: 'ZOMATO' }] }))
    await vault.flush()
    expect(raw.get(VAULT_PREFIX + 'jhapi.pending')).not.toContain('ZOMATO')
    const reopened = await VaultKV.open(raw, key)
    expect(reopened.get('jhapi.pending')).toContain('ZOMATO')

    // A wrong key opens nothing.
    expect((await VaultKV.open(raw, await deriveKey(secretB))).entries()).toEqual([])

    await unsealToPlain(raw, reopened)
    expect(raw.get(LOCK_KEY)).toBeNull()
    expect(raw.keys!().some((k) => k.startsWith(VAULT_PREFIX))).toBe(false)
    expect(raw.get('jhapi.pending')).toContain('ZOMATO')
    expect(new LocalStore(raw).config()?.token).toBe('a'.repeat(64))
    // Late writes from a sync in flight are ignored once unsealed.
    reopened.set('jhapi.snapshot', 'late')
    await reopened.flush()
    expect(raw.get(VAULT_PREFIX + 'jhapi.snapshot')).toBeNull()
  })

  it('forgets everything on the device', async () => {
    const raw = memoryKV()
    raw.set('jhapi.sheet', '{}')
    raw.set(VAULT_PREFIX + 'jhapi.snapshot', 'x')
    raw.set(VAULT_PREFIX + 'jhapi.gemini', 'y')
    raw.set(LOCK_KEY, '{}')
    raw.set('bhag.other', 'kept')
    wipeDevice(raw)
    expect(raw.keys!()).toEqual(['bhag.other'])
  })
})
