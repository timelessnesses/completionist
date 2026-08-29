export function decodeBase64Secret(secret: string): Uint8Array {
	return Uint8Array.from(atob(secret), (character) => character.charCodeAt(0));
}
