import { PushNotifications } from '@capacitor/push-notifications';

export async function requestForNotificationPermission() {
	console.log('push notifications permission request...');
	if ((await PushNotifications.checkPermissions()).receive === 'granted') return;
	console.log('requesting push notifications permission...');
	await PushNotifications.addListener('registration', (token) => {
		console.log('received FCM registration token:', token.value);
		fetch('/api/fcm', {
			method: 'POST',
			body: JSON.stringify({ token: token.value })
		});
	});

	await PushNotifications.requestPermissions();
	console.log('registering for push notifications...');
	await PushNotifications.register();
}

export async function unregisterPushNotifications() {
	console.log('unregistering push notifications...');
	await PushNotifications.removeAllListeners();
	await PushNotifications.unregister();
	await fetch('/api/fcm', {
		method: 'DELETE'
	});
}

export async function unregisterServiceWorker() {
	console.log('unsubscribing from web push...');
	if ('serviceWorker' in navigator) {
		const registration = await navigator.serviceWorker.getRegistration('/');
		const subscription = await registration?.pushManager.getSubscription();
		await subscription?.unsubscribe();
	}
	await fetch('/api/webpush', {
		method: 'DELETE'
	});
}

export async function registerServiceWorker(vapidPublicKey: string) {
	console.log('registering service worker...');
	if ('serviceWorker' in navigator) {
		const permission = await Notification.requestPermission();
		console.log('notification permission:', permission);
		console.log('service worker supported, registering...');
		if (!vapidPublicKey) return;
		const sw = await navigator.serviceWorker.register('/service-worker.js', {
			scope: '/',
			updateViaCache: 'none'
		});
		await sw.update();
		await navigator.serviceWorker.ready;
		console.log('service worker registered:', sw);
		if (permission === 'granted') {
			console.log('notification permission granted, subscribing to push notifications...');
			const subscription = await sw.pushManager.subscribe({
				userVisibleOnly: true,
				applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
			});
			console.log('webpush subscription:', subscription);
			await fetch('/api/webpush', {
				method: 'POST',
				body: JSON.stringify(subscription.toJSON())
			});
		}
	}
}

function urlBase64ToUint8Array(base64String: string) {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}
