import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'child_process';
import cloudflareDo from "sveltekit-cloudflare-do"

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
			durableObjects: [
				"src/lib/durable_objects/GlobalWS.ts"
			]
		})
	]
});