export type Recipient = {
  id: string;
  weight: number;
};

export type Share = {
  recipientId: string;
  cents: number;
};
