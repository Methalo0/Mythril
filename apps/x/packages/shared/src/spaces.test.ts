import { describe, expect, it } from 'vitest';
import { containsMythrilAddress, decorateMentions, mentionToken, resolveMentions } from './spaces.js';

// The app's faces over the protocol's mention grammar: a token carries the id,
// the roster supplies the name, and nothing is ever read out of a bare word.

const arjun = { id: '01M0F8S2MC8HYMF4MYWM61MR7B', displayName: 'Arjun Kumar' };
const names = new Map([[arjun.id, arjun.displayName]]);
const tok = (id: string, label: string) => mentionToken({ kind: 'member', id, label });

describe('containsMythrilAddress', () => {
  it('is the token, never the word', () => {
    expect(containsMythrilAddress('[@mythril](#mythril) move SSO to P1')).toBe(true);
    expect(containsMythrilAddress('yes — [@mythril](#mythril) do it')).toBe(true);
    expect(containsMythrilAddress('@mythril move SSO to P1')).toBe(false);
    expect(containsMythrilAddress('the mythril brand is growing on me')).toBe(false);
    expect(containsMythrilAddress('the trigger is `[@mythril](#mythril)` in a message')).toBe(false);
    expect(containsMythrilAddress('```\n[@mythril](#mythril) do the thing\n```')).toBe(false);
  });
});

describe('decorateMentions / resolveMentions', () => {
  it('render a token by its CURRENT name, keep an unknown id\'s label, and leave code alone', () => {
    const body = `ping ${tok(arjun.id, 'Old Name')} and ${tok('ghost', 'Ghost')} and [@here](#here) \`${tok(arjun.id, 'x')}\``;
    expect(decorateMentions(body, names)).toBe(`ping **@Arjun Kumar** and **@Ghost** and **@here** \`${tok(arjun.id, 'x')}\``);
    expect(resolveMentions(body, names)).toBe(`ping @Arjun Kumar and @Ghost and @here \`${tok(arjun.id, 'x')}\``);
  });

  it('a space token renders as #Name from the listing, or its label when the reader is not in that space', () => {
    const body = `see [#Old](#space:S1) and [#Hidden](#space:S2)`;
    const spaceNames = new Map([['S1', 'General']]);
    expect(decorateMentions(body, names, spaceNames)).toBe('see **#General** and **#Hidden**');
    expect(resolveMentions(body, names, spaceNames)).toBe('see #General and #Hidden');
    expect(resolveMentions(body, names)).toBe('see #Old and #Hidden');
  });

  it('a bare @name or @id is prose and renders as typed', () => {
    expect(decorateMentions('@Arjun Kumar and @01M0F8S2MC8HYMF4MYWM61MR7B', names)).toBe('@Arjun Kumar and @01M0F8S2MC8HYMF4MYWM61MR7B');
    expect(resolveMentions('mail arjun@mythril.com', names)).toBe('mail arjun@mythril.com');
  });
});
