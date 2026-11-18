import { describe, expect, it } from 'vitest'
import { browserPasskeys, PasskeyError } from './passkey'
import { fromB64, toB64url } from './vault'

const RAW_ID = new Uint8Array([1, 2, 3, 250, 251])
const SECRET = new Uint8Array(32).fill(5)

/** A stand-in for navigator.credentials that records what it was asked. */
function fakeCreds(opts: { createPrf?: object; getPrf?: object; fail?: string } = {}) {
  const calls: { create: CredentialCreationOptions[]; get: CredentialRequestOptions[] } = { create: [], get: [] }
  const cred = (prf: object | undefined) => ({ rawId: RAW_ID.buffer, getClientExtensionResults: () => (prf ? { prf } : {}) })
  const creds = {
    async create(o: CredentialCreationOptions) {
      calls.create.push(o)
      if (opts.fail) throw Object.assign(new Error('nope'), { name: opts.fail })
      return cred(opts.createPrf)
    },
    async get(o: CredentialRequestOptions) {
      calls.get.push(o)
      if (opts.fail) throw Object.assign(new Error('nope'), { name: opts.fail })
      return cred(opts.getPrf)
    },
  } as unknown as CredentialsContainer
  return { creds, calls }
}

describe('passkey with PRF', () => {
  it('uses the secret given at creation when the authenticator gives one', async () => {
    const { creds, calls } = fakeCreds({ createPrf: { enabled: true, results: { first: SECRET.buffer } } })
    const made = await browserPasskeys(creds).create('Jhapi on iPhone')
    expect(made.credentialId).toBe(toB64url(RAW_ID))
    expect([...made.secret]).toEqual([...SECRET])
    expect(calls.get).toHaveLength(0)
    const pk = calls.create[0].publicKey!
    expect(pk.user.name).toBe('Jhapi on iPhone')
    expect(pk.authenticatorSelection?.userVerification).toBe('required')
    const salt = (pk.extensions as { prf: { eval: { first: Uint8Array } } }).prf.eval.first
    expect([...salt]).toEqual([...fromB64(made.salt)])
  })

  it('signs in once with the new passkey when creation gives no secret (Safari)', async () => {
    const { creds, calls } = fakeCreds({ createPrf: { enabled: true }, getPrf: { results: { first: SECRET } } })
    const made = await browserPasskeys(creds).create('Jhapi on iPad')
    expect([...made.secret]).toEqual([...SECRET])
    const req = calls.get[0].publicKey!
    expect([...new Uint8Array(req.allowCredentials![0].id as ArrayBuffer)]).toEqual([...RAW_ID])
    expect(req.userVerification).toBe('required')
  })

  it('refuses a passkey that cannot do PRF', async () => {
    const { creds } = fakeCreds({ createPrf: { enabled: false } })
    await expect(browserPasskeys(creds).create('x')).rejects.toMatchObject({ kind: 'noPrf' })
    const { creds: c2 } = fakeCreds({ getPrf: {} })
    await expect(browserPasskeys(c2).unlock(toB64url(RAW_ID), 'c2FsdA==')).rejects.toMatchObject({ kind: 'noPrf' })
  })

  it('says plainly when the owner cancels', async () => {
    const { creds } = fakeCreds({ fail: 'NotAllowedError' })
    const e = await browserPasskeys(creds).unlock(toB64url(RAW_ID), 'c2FsdA==').catch((x) => x)
    expect(e).toBeInstanceOf(PasskeyError)
    expect(e.kind).toBe('cancelled')
    expect(e.message).toMatch(/cancelled/)
  })
})
