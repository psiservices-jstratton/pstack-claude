export type EventPayloads = Record<string, unknown>;
export type Listener<TPayload> = (payload: TPayload) => void;

export class EventHub<TEvents extends EventPayloads> {
  private readonly listeners = new Map<keyof TEvents, Array<Listener<TEvents[keyof TEvents]>>>();

  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as Listener<TEvents[keyof TEvents]>);
    this.listeners.set(event, list);
    return () => this.off(event, listener);
  }

  once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const wrapped: Listener<TEvents[K]> = (payload) => {
      this.off(event, wrapped);
      listener(payload);
    };
    return this.on(event, wrapped);
  }

  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): boolean {
    const list = this.listeners.get(event);
    if (!list) return false;
    const index = list.indexOf(listener as Listener<TEvents[keyof TEvents]>);
    if (index === -1) return false;
    list.splice(index, 1);
    if (list.length === 0) this.listeners.delete(event);
    return true;
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    const list = this.listeners.get(event);
    if (!list) return;
    for (const listener of list) {
      listener(payload as TEvents[keyof TEvents]);
    }
  }

  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}
