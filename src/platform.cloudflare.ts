import { getDb } from "$lib/server/db";
import * as web_push from "web-push"

export { GlobalWS } from "$lib/durable_objects/GlobalWS";

export async function queue(batch: MessageBatch, env: Env, ctx: ExecutionContext) {
    const db = getDb(env.COMPLETIONIST_DB);
    const subscriptions = await db.query.push_subscriptions.findMany();
    web_push.setVapidDetails("mailto:mooping@timelessnesses.me", env.VAPID_PUBLIC, env.VAPID_PRIVATE)
    for (const message of batch.messages) { 
        for (const subscription of subscriptions) { 
            try {
                await web_push.sendNotification({
                    endpoint: subscription.endpoint,
                    keys: {
                        p256dh: subscription.p256dh,
                        auth: subscription.auth
                    },
                }, JSON.stringify(message.body) as string);
                message.ack();
            } catch (e) { 
                console.error(e);
                message.retry();
            }
        }
    }
}                                                       