import { Capacitor, registerPlugin } from '@capacitor/core';

type PickerResult = {
	value?: string;
	cancelled?: boolean;
};

const ModernPicker = registerPlugin<{
	pickDate(options: { value?: string; title?: string }): Promise<PickerResult>;
	pickTime(options: { value?: string; title?: string }): Promise<PickerResult>;
}>('ModernPicker');

export function hasModernAndroidPicker(): boolean {
	return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function pickModernDate(value: string, title: string): Promise<string | null> {
	const result = await ModernPicker.pickDate({ value, title });
	return result.cancelled ? null : (result.value ?? null);
}

export async function pickModernTime(value: string, title: string): Promise<string | null> {
	const result = await ModernPicker.pickTime({ value, title });
	return result.cancelled ? null : (result.value ?? null);
}
