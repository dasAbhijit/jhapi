/**
 * The passkey, through WebAuthn's PRF extension: the authenticator (iCloud Keychain on iPhone and
 * iPad) returns 32 secret bytes for our salt, only after Face ID or Touch ID. Those bytes are the
 * encryption key's source (vault.ts). There is no server: the passkey is not used to log in to
 * anything, so the challenge is just random bytes.
 *
 * The passkey belongs to the site's domain (dasabhijit.github.io today). Moving Jhapi to another
 * address means making a new passkey there.
 */
import { fromB64, fromB64url, randomBytes, toB64, toB64url } from './vault'

export interface NewPasskey {
  credentialId: string
  salt: string
  secret: Uint8Array<ArrayBuffer>
}

/** What the lock needs from a passkey. Swapped for a fake in tests. */
export interface PasskeyApi {
  supported(): boolean
  create(label: string): Promise<NewPasskey>
  unlock(credentialId: string, salt: string): Promise<Uint8Array<ArrayBuffer>>
}

export class PasskeyError extends Error {
  readonly kind: 'cancelled' | 'noPrf' | 'unsupported' | 'failed'
  constructor(kind: PasskeyError['kind'], message: string) {
    super(message)
    this.kind = kind
  }
}

export const NO_PRF =
  "This browser or password app can't use a passkey to encrypt. On iPhone and iPad this needs iOS 18 or later, with the passkey saved in Passwords (iCloud Keychain). Nothing was changed."

type PrfOutputs = { enabled?: boolean; results?: { first?: BufferSource } }

function prfOf(cred: PublicKeyCredential): PrfOutputs | undefined {
  return (cred.getClientExtensionResults() as { prf?: PrfOutputs }).prf
}

function toBytes(b: BufferSource): Uint8Array<ArrayBuffer> {
  const view = b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  return new Uint8Array(view)
}

function explain(e: unknown): PasskeyError {
  if (e instanceof PasskeyError) return e
  const name = (e as { name?: string })?.name
  if (name === 'NotAllowedError' || name === 'AbortError') return new PasskeyError('cancelled', 'The passkey was cancelled or timed out. Try again.')
  if (name === 'InvalidStateError') return new PasskeyError('failed', 'This passkey already exists on this device. Try again.')
  return new PasskeyError('failed', `The passkey did not work${e instanceof Error && e.message ? `: ${e.message}` : '.'}`)
}

export function browserPasskeys(creds: CredentialsContainer | undefined = globalThis.navigator?.credentials): PasskeyApi {
  const get = async (credentialId: string, salt: string) => {
    if (!creds) throw new PasskeyError('unsupported', 'Passkeys are not available in this browser.')
    let cred: PublicKeyCredential | null
    try {
      cred = (await creds.get({
        publicKey: {
          challenge: randomBytes(32),
          allowCredentials: [{ type: 'public-key', id: fromB64url(credentialId) }],
          userVerification: 'required',
          timeout: 120_000,
          extensions: { prf: { eval: { first: fromB64(salt) } } } as AuthenticationExtensionsClientInputs,
        },
      })) as PublicKeyCredential | null
    } catch (e) {
      throw explain(e)
    }
    const first = cred && prfOf(cred)?.results?.first
    if (!first) throw new PasskeyError('noPrf', NO_PRF)
    return toBytes(first)
  }

  return {
    supported: () => typeof globalThis.PublicKeyCredential === 'function' && !!creds,

    async create(label) {
      if (!creds) throw new PasskeyError('unsupported', 'Passkeys are not available in this browser.')
      const salt = toB64(randomBytes(32))
      let cred: PublicKeyCredential | null
      try {
        cred = (await creds.create({
          publicKey: {
            rp: { name: 'Jhapi' },
            user: { id: randomBytes(16), name: label, displayName: label },
            challenge: randomBytes(32),
            pubKeyCredParams: [
              { type: 'public-key', alg: -7 },
              { type: 'public-key', alg: -257 },
            ],
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            timeout: 120_000,
            extensions: { prf: { eval: { first: fromB64(salt) } } } as AuthenticationExtensionsClientInputs,
          },
        })) as PublicKeyCredential | null
      } catch (e) {
        throw explain(e)
      }
      if (!cred) throw new PasskeyError('failed', 'No passkey was made.')
      const credentialId = toB64url(new Uint8Array(cred.rawId))
      const prf = prfOf(cred)
      if (prf?.enabled === false) throw new PasskeyError('noPrf', NO_PRF)
      // Some authenticators give the secret straight away; the rest need one sign-in with the new passkey.
      const first = prf?.results?.first
      const secret = first ? toBytes(first) : await get(credentialId, salt)
      return { credentialId, salt, secret }
    },

    unlock: get,
  }
}
