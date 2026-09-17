import { describe, expect, it } from 'vitest'
import { containsMythrilAddress } from './spaces-mentions'

describe('containsMythrilAddress', () => {
    it('is the token the composer emits, anywhere outside code', () => {
        expect(containsMythrilAddress('[@mythril](#mythril) move SSO to P1')).toBe(true)
        expect(containsMythrilAddress('yes — [@mythril](#mythril) move SSO to P1')).toBe(true)
        expect(containsMythrilAddress('([@mythril](#mythril) can you tidy this?)')).toBe(true)
    })

    it('never the bare word — that is prose, not an address', () => {
        expect(containsMythrilAddress('@mythril move SSO to P1')).toBe(false)
        expect(containsMythrilAddress('we should ship spaces this week')).toBe(false)
        expect(containsMythrilAddress('the mythril brand is growing on me')).toBe(false)
        expect(containsMythrilAddress('mail me at team@mythril.com')).toBe(false)
    })

    it('code is citation, not address', () => {
        expect(containsMythrilAddress('the trigger is `[@mythril](#mythril)` in a message')).toBe(false)
        expect(containsMythrilAddress('```\n[@mythril](#mythril) do the thing\n```')).toBe(false)
        expect(containsMythrilAddress('```ts\nsend("[@mythril](#mythril) hi")')).toBe(false) // unterminated fence
    })
})
