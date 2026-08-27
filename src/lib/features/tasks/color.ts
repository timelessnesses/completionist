import type { TaskColor } from './types';

export function colorToHex(color: TaskColor): string {
	return `#${[color.r, color.g, color.b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function hexToColor(hex: string): TaskColor {
	const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if (!match) return { r: 11, g: 87, b: 208 };
	return {
		r: Number.parseInt(match[1], 16),
		g: Number.parseInt(match[2], 16),
		b: Number.parseInt(match[3], 16)
	};
}
