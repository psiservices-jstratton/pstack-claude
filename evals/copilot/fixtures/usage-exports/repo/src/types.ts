export type Account = {
  id: string;
  timezoneOffsetMinutes: number;
  plan: "free" | "team" | "enterprise";
};

export type UsageEvent = {
  id: string;
  accountId: string;
  occurredAt: string;
  product: "api" | "storage";
  units: number;
  billable: boolean;
};

export type DateRange = {
  start: string;
  end: string;
};
