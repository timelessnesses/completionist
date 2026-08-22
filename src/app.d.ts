// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

declare global {
	/** Injected by vite.config.ts `define` at build time */
	const __GIT_COMMIT: string;
	/** Injected by vite.config.ts `define` at build time */
	const __BUILD_DATE: string;

	// Secrets (set via `wrangler secret put` / dashboard) are not visible to
	// `wrangler types`, so they can't live in the generated worker-configuration.d.ts.
	// Declare them here via interface merging so `env.FCM_SERVICE_ACCOUNT` is typed.
	interface Env {
		/** Firebase service-account JSON used to mint OAuth tokens for FCM. */
		FCM_SERVICE_ACCOUNT: string;
	}

	namespace App {
		interface Platform {
			env: Env;
			cf: CfProperties;
			ctx: ExecutionContext;
		}

		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		interface Locals {
			user:
				| {
						email: string;
						user_id: string;
						name: string;
						nickname: string;
						admin: boolean;
				  }
				| undefined;
			request_start_time: number;
		}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
