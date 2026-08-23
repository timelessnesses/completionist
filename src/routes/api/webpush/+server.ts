import { getDb } from '$lib/server/db/index.js';

export const POST = async ({ request, platform, locals }) => {
    const db = getDb((platform?.env as Env).COMPLETIONIST_DB, locals.user?.id);
};
