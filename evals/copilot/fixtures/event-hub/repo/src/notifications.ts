import { EventHub } from "./event-hub.ts";
import type { AppEvents } from "./audit.ts";

export class NoticeBoard {
  readonly messages: string[] = [];

  attachTo(hub: EventHub<AppEvents>): () => void {
    return hub.on("notice", (message) => {
      this.messages.push(message.trim());
    });
  }
}
