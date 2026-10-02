export type DiscountRule = {
  percent: number;
  minSubtotal: number;
  label: string;
};

const RULES: Record<string, DiscountRule> = {
  gold: { percent: 10, minSubtotal: 0, label: "Gold 10%" },
  silver: { percent: 5, minSubtotal: 5_000, label: "Silver 5%" },
  basic: { percent: 0, minSubtotal: 0, label: "No discount" },
};

const cache = new Map<string, DiscountRule>();

export function ruleFor(tier: string): DiscountRule {
  let rule = cache.get(tier);
  if (!rule) {
    rule = RULES[tier] ?? RULES.basic;
    cache.set(tier, rule);
  }
  return rule;
}

export function knownTiers(): string[] {
  return Object.keys(RULES);
}
