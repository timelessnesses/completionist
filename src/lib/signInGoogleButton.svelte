<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { Capacitor } from '@capacitor/core';
	import { GoogleSignIn } from '@capawesome/capacitor-google-sign-in';
	import yes from "$lib/yes.svg"

	async function trySignIn() {
		console.log("Signing in from native")
		const result = await GoogleSignIn.signIn()
		console.log("Result from native sign in", result)
		fetch('/api/auth/google-jwt', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				id_token: result.idToken
			}),
			credentials: 'include'
		})
			.then((r) => {
				if (!r.ok) throw new Error('Failed to sign in with Google');
				window.location.href = '/';
			})
			.catch((err) => {
				console.error('Error during Google sign-in:', err);
				alert('Failed to sign in with Google. Please try again.');
			});
	}
	let ready = $state(false);
	if (Capacitor.isNativePlatform()) {
		onMount(async () => {
			await GoogleSignIn.initialize({
				clientId: env.PUBLIC_GOOGLE_OAUTH_CLIENT_ID as string,
				scopes: ['email', 'profile'],
			})
			ready = true
			await trySignIn();
		})

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
				.then((r) => {
					if (!r.ok) throw new Error('Failed to sign in with Google');
					window.location.href = '/';
				})
				.catch((err) => {
					console.error('Error during Google sign-in:', err);
					alert('Failed to sign in with Google. Please try again.');
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
	<p class="text-red-500">Google OAuth client ID (or android version) is not set in environment variables.</p>
{:else}
	{#if Capacitor.isNativePlatform()}
		<button onclick={async () => {
				await trySignIn();
		}}>
			<img src={yes} alt="Google Sign In Button" style:visibility={ready ? "visible" : "hidden"} />
		</button>
	{:else}
		<div id="google-button"></div>
	{/if}
{/if}
<svelte:head>
	<script src="https://accounts.google.com/gsi/client" defer async id="GSIWaiting"></script>
</svelte:head>