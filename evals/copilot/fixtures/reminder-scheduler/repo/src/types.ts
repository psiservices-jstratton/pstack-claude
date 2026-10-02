export type Recurrence = "daily" | "weekly";

export type Reminder = {
  id: string;
  userId: string;
  timeZone: string;
  hour: number;
  minute: number;
  recurrence: Recurrence;
  lastSentAt?: string;
  paused?: boolean;
};

export type ScheduledReminder = {
  reminderId: string;
  userId: string;
  deliverAt: string;
};
