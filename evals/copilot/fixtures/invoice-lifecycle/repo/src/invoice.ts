export type Invoice = {
  id: string;
  customerId: string;
  cents: number;
  sent: boolean;
  paid: boolean;
  voided: boolean;
  refunded: boolean;
  sentAt?: string;
  paidAt?: string;
  voidedAt?: string;
  refundedAt?: string;
};

export function createInvoice(id: string, customerId: string, cents: number): Invoice {
  if (cents <= 0) throw new Error("invoice total must be positive");
  return { id, customerId, cents, sent: false, paid: false, voided: false, refunded: false };
}

export function sendInvoice(invoice: Invoice, at: string): Invoice {
  if (invoice.voided) throw new Error("cannot send voided invoice");
  if (invoice.sent) return invoice;
  return { ...invoice, sent: true, sentAt: at };
}

export function payInvoice(invoice: Invoice, at: string): Invoice {
  if (invoice.voided) throw new Error("cannot pay voided invoice");
  if (invoice.paid) return invoice;
  return { ...invoice, paid: true, paidAt: at };
}

export function voidInvoice(invoice: Invoice, at: string): Invoice {
  if (invoice.paid) throw new Error("cannot void paid invoice");
  if (invoice.voided) return invoice;
  return { ...invoice, voided: true, voidedAt: at };
}

export function refundInvoice(invoice: Invoice, at: string): Invoice {
  if (!invoice.paid) throw new Error("cannot refund unpaid invoice");
  if (invoice.refunded) return invoice;
  return { ...invoice, refunded: true, refundedAt: at };
}

export function invoiceSummary(invoice: Invoice) {
  const status = invoice.refunded ? "refunded" : invoice.voided ? "voided" : invoice.paid ? "paid" : invoice.sent ? "sent" : "draft";
  return {
    id: invoice.id,
    customerId: invoice.customerId,
    cents: invoice.cents,
    status,
  };
}
