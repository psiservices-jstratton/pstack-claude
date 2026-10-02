export type SessionRecord = {
  userId: string;
  data: string;
  updatedAt: number;
};

export type StoredSession = {
  id: string;
  record: SessionRecord;
  bytes: number;
};
