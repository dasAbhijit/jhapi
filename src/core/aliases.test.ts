import { describe, expect, it } from 'vitest'
import { aliasFor, aliasMap, senderKey, shownName, type Alias } from './aliases'

const a = (p: Partial<Alias>): Alias => ({ id: 'a', name: 'BUNDL TECHNOLOGIES', showAs: 'Swiggy', updatedAt: '2026-11-17T10:00:00.000Z', deleted: false, ...p })

describe('display names', () => {
  it('shows the alias with the bank name underneath, ignoring case and spaces', () => {
    const m = aliasMap([a({})])
    expect(shownName('bundl   technologies ', m)).toEqual({ title: 'Swiggy', raw: 'bundl   technologies ' })
    expect(shownName('Zomato', m)).toEqual({ title: 'Zomato', raw: null })
    // An alias that only changes case does not repeat the name underneath.
    expect(shownName('SWIGGY', aliasMap([a({ name: 'SWIGGY', showAs: 'Swiggy' })]))).toEqual({ title: 'Swiggy', raw: null })
  })

  it('skips deleted and empty aliases; the newer of two for one name wins', () => {
    expect(aliasMap([a({ deleted: true }), a({ id: 'b', showAs: ' ' })]).size).toBe(0)
    const m = aliasMap([a({ id: 'old', showAs: 'Old', updatedAt: '2026-01-01T00:00:00.000Z' }), a({ id: 'new', showAs: 'New' })])
    expect(shownName('BUNDL TECHNOLOGIES', m).title).toBe('New')
  })

  it('bank names sharing a display name are one sender', () => {
    const m = aliasMap([a({}), a({ id: 'b', name: 'swiggy@axisbank' })])
    expect(senderKey('BUNDL TECHNOLOGIES', m)).toBe(senderKey('SWIGGY@AXISBANK', m))
    expect(senderKey('Zomato', m)).not.toBe(senderKey('BUNDL TECHNOLOGIES', m))
  })

  it('works out the row to save when a name is set, changed or cleared', () => {
    const id = () => 'new-id'
    expect(aliasFor('Asha K', 'Maid', [], id)).toEqual({ id: 'new-id', name: 'Asha K', showAs: 'Maid', updatedAt: '', deleted: false })
    expect(aliasFor('Asha K', '', [], id)).toBeNull()
    expect(aliasFor('Asha K', ' Asha K ', [], id)).toBeNull()
    expect(aliasFor('SWIGGY', 'Swiggy', [], id)).toMatchObject({ name: 'SWIGGY', showAs: 'Swiggy' })
    expect(aliasFor('', 'Maid', [], id)).toBeNull()
    const cur = a({})
    expect(aliasFor('bundl technologies', 'Swiggy', [cur], id)).toBeNull()
    expect(aliasFor('BUNDL TECHNOLOGIES', 'Swiggy Food', [cur], id)).toMatchObject({ id: 'a', showAs: 'Swiggy Food', deleted: false })
    expect(aliasFor('BUNDL TECHNOLOGIES', '', [cur], id)).toMatchObject({ id: 'a', deleted: true })
  })
})
