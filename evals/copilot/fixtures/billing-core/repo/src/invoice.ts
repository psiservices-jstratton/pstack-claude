import { ruleFor } from "./pricing/rules.ts";
import { findPromo, withPromo } from "./promotions.ts";
import { taxFor } from "./tax.ts";

export type Customer = { id: string; tier: string; state: string };
export type Line = { sku: string; unitPrice: number; quantity: number };

export type Invoice = {
  customerId: string;
  subtotal: number;
  discount: number;
  discountLabel: string;
  tax: number;
  total: number;
};

export function buildInvoice(
  customer: Customer,
  lines: Line[],
  options: { promoCode?: string; today: string },
): Invoice {
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const promo = findPromo(options.promoCode, options.today);
  const rule = withPromo(ruleFor(customer.tier), promo);
  const discount = subtotal >= rule.minSubtotal ? Math.round((subtotal * rule.percent) / 100) : 0;
  const tax = taxFor(customer.state, subtotal - discount);
  return {
    customerId: customer.id,
    subtotal,
    discount,
    discountLabel: discount > 0 ? rule.label : "",
    tax,
    total: subtotal - discount + tax,
  };
}
