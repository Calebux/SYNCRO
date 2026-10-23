import {
  DOMAIN_TERMS,
  DOMAIN_LAYER_MAPPING,
  isValidSubscriptionTransition,
  isValidRenewalTransition,
} from '../types/domain-glossary';

describe('Domain Glossary & Layer Mapping', () => {
  it('defines all canonical domain terms', () => {
    expect(DOMAIN_TERMS).toContain('subscription');
    expect(DOMAIN_TERMS).toContain('renewal');
    expect(DOMAIN_TERMS).toContain('payment');
    expect(DOMAIN_TERMS).toContain('charge');
    expect(DOMAIN_TERMS).toContain('settlement');
    expect(DOMAIN_TERMS).toContain('escrow');
    expect(DOMAIN_TERMS).toContain('channel');
    expect(DOMAIN_TERMS).toContain('card');
    expect(DOMAIN_TERMS).toContain('gift_card');
    expect(DOMAIN_TERMS).toContain('stealth_payment');
  });

  it('has layer mapping entries for all domain terms', () => {
    for (const term of DOMAIN_TERMS) {
      const mapping = DOMAIN_LAYER_MAPPING[term];
      expect(mapping).toBeDefined();
      expect(mapping.contract).toBeTruthy();
      expect(mapping.database).toBeTruthy();
      expect(mapping.backendApi).toBeTruthy();
      expect(mapping.clientUi).toBeTruthy();
      expect(mapping.sdk).toBeTruthy();
    }
  });

  describe('Subscription State Transitions', () => {
    it('allows valid subscription transitions', () => {
      expect(isValidSubscriptionTransition('active', 'paused')).toBe(true);
      expect(isValidSubscriptionTransition('active', 'cancelled')).toBe(true);
      expect(isValidSubscriptionTransition('active', 'expired')).toBe(true);
      expect(isValidSubscriptionTransition('trial', 'active')).toBe(true);
      expect(isValidSubscriptionTransition('paused', 'active')).toBe(true);
      expect(isValidSubscriptionTransition('expired', 'active')).toBe(true);
    });

    it('rejects invalid subscription transitions', () => {
      expect(isValidSubscriptionTransition('cancelled', 'active')).toBe(false);
      expect(isValidSubscriptionTransition('cancelled', 'paused')).toBe(false);
      expect(isValidSubscriptionTransition('active', 'trial')).toBe(false);
    });
  });

  describe('Renewal State Transitions', () => {
    it('allows valid renewal transitions', () => {
      expect(isValidRenewalTransition('scheduled', 'cooldown')).toBe(true);
      expect(isValidRenewalTransition('cooldown', 'pending_approval')).toBe(true);
      expect(isValidRenewalTransition('cooldown', 'executing')).toBe(true);
      expect(isValidRenewalTransition('pending_approval', 'approved')).toBe(true);
      expect(isValidRenewalTransition('approved', 'executing')).toBe(true);
      expect(isValidRenewalTransition('executing', 'settled')).toBe(true);
      expect(isValidRenewalTransition('executing', 'failed')).toBe(true);
      expect(isValidRenewalTransition('failed', 'scheduled')).toBe(true);
      expect(isValidRenewalTransition('failed', 'dead_lettered')).toBe(true);
    });

    it('rejects invalid renewal transitions', () => {
      expect(isValidRenewalTransition('settled', 'executing')).toBe(false);
      expect(isValidRenewalTransition('dead_lettered', 'scheduled')).toBe(false);
      expect(isValidRenewalTransition('scheduled', 'settled')).toBe(false);
    });
  });
});
