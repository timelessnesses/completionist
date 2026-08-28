import { Capacitor, registerPlugin } from '@capacitor/core';

type Icons = 'IconLight' | 'IconDark';

const ChangeIconPlugin = registerPlugin<{
	setIcon(options: { name: Icons }): Promise<{ name: Icons }>;
}>('ChangeIconPlugin');

export async function setIcon(name: Icons) {
	if (!Capacitor.isNativePlatform()) {
		console.warn('setIcon is only available on native platforms.');
		return;
	}
	return await ChangeIconPlugin.setIcon({ name });
}
