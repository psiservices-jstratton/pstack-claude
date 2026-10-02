import type { Reminder, ScheduledReminder } from "./types.ts";
import { advanceLocalDate, localParts, resolveWallTime } from "./timeZone.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

function recurrenceDays(reminder: Reminder): number {
  return reminder.recurrence === "weekly" ? 7 : 1;
}

function withReminderTime(reminder: Reminder, parts: ReturnType<typeof localParts>): ReturnType<typeof localParts> {
  return { ...parts, hour: reminder.hour, minute: reminder.minute };
}

export function nextDelivery(reminder: Reminder, nowIso: string): ScheduledReminder | undefined {
  if (reminder.paused) return undefined;
  const now = new Date(nowIso);

  if (reminder.lastSentAt) {
    const elapsed = recurrenceDays(reminder) * DAY_MS;
    return {
      reminderId: reminder.id,
      userId: reminder.userId,
      deliverAt: new Date(new Date(reminder.lastSentAt).getTime() + elapsed).toISOString(),
    };
  }

  let localDate = withReminderTime(reminder, localParts(now, reminder.timeZone));
  let deliverAt = resolveWallTime(reminder.timeZone, localDate);
  while (new Date(deliverAt).getTime() <= now.getTime()) {
    localDate = withReminderTime(reminder, advanceLocalDate(localDate, recurrenceDays(reminder)));
    deliverAt = resolveWallTime(reminder.timeZone, localDate);
  }

  return { reminderId: reminder.id, userId: reminder.userId, deliverAt };
}

export function dueReminders(reminders: Reminder[], nowIso: string): ScheduledReminder[] {
  return reminders
    .map((reminder) => nextDelivery(reminder, nowIso))
    .filter((entry): entry is ScheduledReminder => entry !== undefined)
    .sort((a, b) => a.deliverAt.localeCompare(b.deliverAt) || a.reminderId.localeCompare(b.reminderId));
}
