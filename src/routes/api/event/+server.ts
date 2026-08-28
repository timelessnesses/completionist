// Backwards-compatible singular endpoint. Keep event deletion logic in /api/events.
export { DELETE } from '../events/+server';
export { PUT } from '../events/+server';