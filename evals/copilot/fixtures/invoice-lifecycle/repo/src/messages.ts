import { invoiceSummary, type Invoice } from "./invoice.ts";
import { formatCents } from "./money.ts";

export type Message = {
  subject: string;
  body: string;
};

export function buildSendMessage(invoice: Invoice): Message {
  const summary = invoiceSummary(invoice);
  return {
    subject: `Invoice ${summary.id} is ready`,
    body: `Your invoice for ${formatCents(summary.cents)} is ${summary.status}.`,
  };
}

export function buildReceiptMessage(invoice: Invoice): Message {
  const summary = invoiceSummary(invoice);
  return {
    subject: `Receipt for ${summary.id}`,
    body: `We recorded ${formatCents(summary.cents)} for customer ${summary.customerId}.`,
  };
}

export function buildVoidMessage(invoice: Invoice): Message {
  const summary = invoiceSummary(invoice);
  return {
    subject: `Invoice ${summary.id} was voided`,
    body: `No payment is due for ${formatCents(summary.cents)}.`,
  };
}
