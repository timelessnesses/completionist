import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import { withDatabaseTiming } from './timing';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { isNull } from 'drizzle-orm';

export const getDb = (d1: D1Database) => drizzle(withDatabaseTiming(d1), { schema });
export const notDeleted = (table: { deleted_at: AnySQLiteColumn }) => isNull(table.deleted_at);
