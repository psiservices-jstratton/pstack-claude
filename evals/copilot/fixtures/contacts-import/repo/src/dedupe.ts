import { normalizeEmail, normalizePhone } from "./normalize.ts";

export type Contact = {
  id: string;
  name: string;
  email: string;
  phone: string;
};

// A contact is a duplicate when its email or its phone matches a contact we
// already kept. The first occurrence wins. Blank fields never match.
export function dedupeContacts(contacts: Contact[]): Contact[] {
  const kept: Contact[] = [];
  for (const contact of contacts) {
    const email = normalizeEmail(contact.email);
    const phone = normalizePhone(contact.phone);
    const duplicate = kept.some((other) => {
      const sameEmail = email !== "" && normalizeEmail(other.email) === email;
      const samePhone = phone !== "" && normalizePhone(other.phone) === phone;
      return sameEmail || samePhone;
    });
    if (!duplicate) kept.push(contact);
  }
  return kept;
}
