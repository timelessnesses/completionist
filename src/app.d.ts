// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
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
			user: {
				email: string;
				user_id: string;
				name: string;
				nickname: string;
				admin: boolean;
			} | undefined;
		}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
