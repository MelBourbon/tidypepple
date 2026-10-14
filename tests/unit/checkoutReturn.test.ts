import { describe, expect, it } from 'vitest';
import { stripCheckoutReturn } from '@/billing/checkoutReturn';

describe('stripCheckoutReturn', () => {
  it('erkennt die Rückkehr aus dem Checkout und nimmt nur diesen Parameter heraus', () => {
    expect(stripCheckoutReturn('?checkout=done')).toEqual({ search: '', returned: true });
    expect(stripCheckoutReturn('?checkout=done&capture=1')).toEqual({ search: '?capture=1', returned: true });
  });

  it('lässt alles andere unverändert', () => {
    expect(stripCheckoutReturn('')).toEqual({ search: '', returned: false });
    expect(stripCheckoutReturn('?checkout=other')).toEqual({ search: '?checkout=other', returned: false });
  });
});
