import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import { withDatabaseTiming } from './timing';

export const getDb = (d1: D1Database) => drizzle(withDatabaseTiming(d1), { schema });
