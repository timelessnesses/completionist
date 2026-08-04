/// <reference lib="webworker" />
/// <reference lib="webworker.iterable" />

export {}; // makes this file a module, isolating its scope
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

