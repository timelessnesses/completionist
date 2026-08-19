import { getDb } from '$lib/server/db/index.js'
import { task } from '$lib/server/db/schema.js'
import { lt, gte, and } from 'drizzle-orm'
import type { PageServerLoad } from './$types'
export const load: PageServerLoad = async ({ params, request, platform }) => { 
    const db = getDb((platform?.env as Env).COMPLETIONIST_DB)

    const tasks = await db.query.task.findMany({
        where: and(
            gte(task.start_at, getMonthFromDate(new Date(), -1)),
            lt(task.start_at, getMonthFromDate(new Date(), 2))
        ),
    })  

    return {
        event: tasks,
        upcoming: tasks.filter(t => t.start_at > new Date())
    }
}

function getMonthFromDate(date: Date, forward: number): Date {
    return new Date(date.getFullYear(), date.getMonth() + forward, 1);
}