<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { Capacitor } from '@capacitor/core';
	import { GoogleSignIn } from '@capawesome/capacitor-google-sign-in';
	import yes from '$lib/yes.svg';

	let ready = $state(false);
	let signingIn = $state(false);

	async function trySignIn() {
		if (!ready || signingIn) return;

		signingIn = true;
		try {
			const result = await GoogleSignIn.signIn();
			const response = await fetch('/api/auth/google-jwt', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					id_token: result.idToken
				}),
				credentials: 'include'
			});

			if (!response.ok) {
				const body = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(body?.error || 'Failed to sign in with Google');
			}
			window.location.href = '/';
		} catch (err) {
			console.error('Error during Google sign-in:', err);
			alert(
				err instanceof Error ? err.message : 'Failed to sign in with Google. Please try again.'
			);
		} finally {
			signingIn = false;
		}
	}

	if (Capacitor.isNativePlatform()) {
		onMount(async () => {
			try {
				await GoogleSignIn.initialize({
					clientId: env.PUBLIC_GOOGLE_OAUTH_CLIENT_ID as string
				});
				ready = true;
			} catch (err) {
				console.error('Failed to initialize Google sign-in:', err);
			}
		});
	} else {
		function handleLoginRequest(response: { credential: string }) {
			fetch('/api/auth/google-jwt', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					id_token: response.credential
				}),
				credentials: 'include'
			})
				.then(async (r) => {
					if (!r.ok) {
						const body = (await r.json().catch(() => null)) as { error?: string } | null;
						throw new Error(body?.error || 'Failed to sign in with Google');
					}
					window.location.href = '/';
				})
				.catch((err) => {
					console.error('Error during Google sign-in:', err);
					alert(
						err instanceof Error ? err.message : 'Failed to sign in with Google. Please try again.'
					);
				});
		}

		const GSILoader = () => {
			// @ts-expect-error - window.google is there
			if (window.google) {
				if (!env.PUBLIC_GOOGLE_OAUTH_CLIENT_ID) {
					throw new Error('Google OAuth client ID is not set in environment variables.');
				}
				if (!env.PUBLIC_ORGANIZATION_DOMAIN) {
					throw new Error('Organization domain is not set in environment variables.');
				}
				// @ts-expect-error - window.google is there
				window.google.accounts.id.initialize({
					client_id: env.PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
					callback: handleLoginRequest,
					hd: env.PUBLIC_ORGANIZATION_DOMAIN
				});
				// @ts-expect-error - window.google is there
				window.google.accounts.id.renderButton(document.getElementById('google-button')!, {
					theme: 'filled_blue',
					size: 'large',
					text: 'signin_with',
					width: 600,
					height: 200
				});
				// @ts-expect-error - window.google is there
				window.google.accounts.id.prompt();
			}
		};

		onMount(() => {
			const scriptThing = document.getElementById('GSIWaiting') as HTMLScriptElement;
			if (scriptThing) {
				scriptThing.addEventListener('load', GSILoader);
			}
			GSILoader();
			return () => {
				if (scriptThing) {
					scriptThing.removeEventListener('load', GSILoader);
				}
			};
		});
	}
</script>

{#if !env.PUBLIC_GOOGLE_OAUTH_CLIENT_ID || !env.PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID}
	<p class="text-red-500">
		Google OAuth client ID (or android version) is not set in environment variables.
	</p>
{:else}
	{#if Capacitor.isNativePlatform()}
		<button disabled={!ready || signingIn} onclick={trySignIn}>
			<img src={yes} alt="Google Sign In Button" style:visibility={ready ? 'visible' : 'hidden'} />
		</button>
	{:else}
		<div id="google-button"></div>
	{/if}
{/if}
<svelte:head>
	<script src="https://accounts.google.com/gsi/client" defer async id="GSIWaiting"></script>
</svelte:head>
