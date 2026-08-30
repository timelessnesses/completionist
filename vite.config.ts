import tailwindcss from '@tailwindcss/vite';
import adapter from '@joshthomas/sveltekit-adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import adapterOriginal from '@sveltejs/adapter-cloudflare';
import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import cloudflareDo from 'sveltekit-cloudflare-do';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

const gitCommit = execSync('git rev-parse --short HEAD').toString().trim();

const buildDate = new Date().toISOString();

export default defineConfig({
	define: {
		__GIT_COMMIT: JSON.stringify(gitCommit),
		__BUILD_DATE: JSON.stringify(buildDate)
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
				}
			}
		}),
		cloudflareDo({
			durableObjects: ['src/lib/durable_objects/GlobalWS.ts']
		}),
		SvelteKitPWA({
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'service-worker.js',
			injectManifest: {
				injectionPoint: undefined
			},
			registerType: 'autoUpdate',
			manifest: {
				name: 'Coworking Calendar',
				short_name: 'Co-Calendar',
				description: 'Collaboration tool for working with the team.',
				theme_color: '#0b57d0',
				background_color: '#ffffff',
				display: 'standalone',
				start_url: '/',
				scope: '/',
				icons: [
					{
						src: '/icons/pwa-192.png',
						sizes: '192x192',
						type: 'image/png',
						purpose: 'any maskable'
					},
					{
						src: '/icons/pwa-512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any maskable'
					}
				]
			}
		})
	],
	build: {
		sourcemap: true
	}
});
