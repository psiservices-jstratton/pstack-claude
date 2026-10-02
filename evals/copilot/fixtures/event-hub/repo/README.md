# event-hub

A tiny in-process event hub used by audit and notification modules. Listeners are called in the order they were registered.

The listener set for an emit is decided when emit begins. Listeners added or removed while an emit is running affect later emits only.

Run `npm test` with Node 24.
