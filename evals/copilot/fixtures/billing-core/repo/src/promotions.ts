import type { DiscountRule } from "./pricing/rules.ts";

export type Promo = {
  code: string;
  extraPercent: number;
  expires: string;
};

const PROMOS: Promo[] = [
  { code: "SPRING5", extraPercent: 5, expires: "2099-06-30" },
  { code: "LOYAL3", extraPercent: 3, expires: "2099-12-31" },
];

export function findPromo(code: string | undefined, today: string): Promo | undefined {
  if (!code) return undefined;
  const promo = PROMOS.find((p) => p.code === code.trim().toUpperCase());
  if (!promo || promo.expires < today) return undefined;
  return promo;
}

export function withPromo(rule: DiscountRule, promo: Promo | undefined): DiscountRule {
  if (!promo) return rule;
  rule.percent += promo.extraPercent;
  rule.label = `${rule.label} + ${promo.code}`;
  return rule;
}
