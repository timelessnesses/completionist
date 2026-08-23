/// <reference lib="webworker" />
/// <reference lib="webworker.iterable" />

export {};
const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

self.addEventListener('push', event => {
    if (event.data) {
        data = event.data.json();
    }

    const options = {
        body: data.body,
        data: { url: data.url || '/' }
    };

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.openWindow(event.notification.data.url)
    );
});