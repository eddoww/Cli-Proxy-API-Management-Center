import { describe, expect, test } from 'bun:test';
import { resolveClaudePlanType } from '@/features/quota/providers/claude/data';
import type { ClaudeProfileResponse } from '@/types';

describe('Claude plan type', () => {
  test.each([
    { has_claude_max: false, has_claude_pro: true },
    { has_claude_max: true, has_claude_pro: false },
    { has_claude_max: true, has_claude_pro: true },
    { has_claude_max: false, has_claude_pro: false },
    {},
  ])('prefers the active Team organization over account flags %j', (account) => {
    expect(
      resolveClaudePlanType({
        account,
        organization: { organization_type: 'claude_team', subscription_status: 'active' },
      })
    ).toBe('plan_team');
  });

  test.each([
    [{ has_claude_max: false, has_claude_pro: true }, 'plan_pro'],
    [{ has_claude_max: true, has_claude_pro: true }, 'plan_max'],
    [{ has_claude_max: false, has_claude_pro: false }, 'plan_free'],
    [{}, null],
  ] as const)('preserves personal plan detection for %j', (account, expected) => {
    expect(
      resolveClaudePlanType({
        account,
        organization: { organization_type: 'claude_pro', subscription_status: 'active' },
      })
    ).toBe(expected);
    expect(resolveClaudePlanType({ account })).toBe(expected);
  });

  test.each(['inactive', 'canceled', undefined])(
    'does not label a Team organization with status %s as active Team',
    (subscriptionStatus) => {
      expect(
        resolveClaudePlanType({
          account: { has_claude_pro: true },
          organization: {
            organization_type: 'claude_team',
            subscription_status: subscriptionStatus,
          },
        })
      ).toBe('plan_pro');
    }
  );

  test('preserves case-insensitive organization matching', () => {
    expect(
      resolveClaudePlanType({
        account: { has_claude_pro: true },
        organization: { organization_type: 'CLAUDE_TEAM', subscription_status: 'ACTIVE' },
      })
    ).toBe('plan_team');
  });

  test.each([
    ['default_claude_max_20x', 'plan_max20'],
    ['default_claude_max_5x', 'plan_max5'],
    ['  DEFAULT_CLAUDE_MAX_20X  ', 'plan_max20'],
  ] as const)('separates Max by the organization rate-limit tier %s', (tier, expected) => {
    expect(
      resolveClaudePlanType({
        account: { has_claude_max: true, has_claude_pro: true },
        organization: { rate_limit_tier: tier },
      })
    ).toBe(expected);
  });

  test('accepts the camelCase rateLimitTier spelling', () => {
    expect(
      resolveClaudePlanType({
        account: { has_claude_max: true },
        organization: { rateLimitTier: 'default_claude_max_5x' },
      } as ClaudeProfileResponse)
    ).toBe('plan_max5');
  });

  test.each(['default_claude_ai', 'unknown_tier', undefined])(
    'keeps an undifferentiated Max when the tier is %s',
    (tier) => {
      expect(
        resolveClaudePlanType({
          account: { has_claude_max: true },
          organization: { rate_limit_tier: tier },
        })
      ).toBe('plan_max');
    }
  );

  test('does not read Pro from default_claude_ai', () => {
    expect(
      resolveClaudePlanType({
        account: { has_claude_max: false, has_claude_pro: false },
        organization: { rate_limit_tier: 'default_claude_ai' },
      })
    ).toBe('plan_free');
  });

  test.each(['Ultra', 'ultra', ' ULTRA plan ', 'Ultra 20x'])(
    'treats the display name %p as the renamed Max 20x plan',
    (planDisplayName: string) => {
      expect(
        resolveClaudePlanType({
          account: { has_claude_max: true },
          // Anthropic left the tier at max_20x when it renamed the plan, so the
          // display name is the only field carrying "Ultra".
          organization: {
            rate_limit_tier: 'default_claude_max_20x',
            plan_display_name: planDisplayName,
          },
        })
      ).toBe('plan_ultra');
    }
  );

  test('lets a renamed plan win over the stale max_20x tier', () => {
    const profile: ClaudeProfileResponse = {
      account: { has_claude_max: true, has_claude_pro: false },
      organization: {
        organization_type: 'claude_max',
        rate_limit_tier: 'default_claude_max_20x',
        plan_display_name: 'Ultra',
        plan_display_label: 'Ultra plan',
      },
    };
    expect(resolveClaudePlanType(profile)).toBe('plan_ultra');
  });

  test('falls back to the tier when the display name is unrelated or missing', () => {
    expect(
      resolveClaudePlanType({
        account: { has_claude_max: true },
        organization: { rate_limit_tier: 'default_claude_max_20x', plan_display_name: 'Max' },
      })
    ).toBe('plan_max20');
    expect(
      resolveClaudePlanType({
        account: { has_claude_max: true },
        organization: { rate_limit_tier: 'default_claude_max_5x' },
      })
    ).toBe('plan_max5');
  });

  test('an active Team organization still wins over a Max tier', () => {
    expect(
      resolveClaudePlanType({
        account: { has_claude_max: true },
        organization: {
          organization_type: 'claude_team',
          subscription_status: 'active',
          rate_limit_tier: 'default_claude_max_20x',
        },
      })
    ).toBe('plan_team');
  });

  test.each([
    null,
    {},
    { account: { has_claude_max: false } },
  ] satisfies (ClaudeProfileResponse | null)[])(
    'returns unknown for an incomplete profile %j',
    (profile) => {
      expect(resolveClaudePlanType(profile)).toBeNull();
    }
  );
});
