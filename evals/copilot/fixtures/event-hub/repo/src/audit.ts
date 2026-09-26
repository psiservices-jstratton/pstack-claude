import { EventHub } from "./event-hub.ts";

export type AuditEvent = {
  actor: string;
  action: string;
  entityId: string;
};

export type AppEvents = {
  audit: AuditEvent;
  notice: string;
};

export class AuditTrail {
  readonly events: string[] = [];

  attachTo(hub: EventHub<AppEvents>): () => void {
    return hub.on("audit", (event) => {
      this.events.push(`${event.actor}:${event.action}:${event.entityId}`);
    });
  }
}
