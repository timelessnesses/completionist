const statements = new WeakMap<
	D1PreparedStatement,
	{ original: D1PreparedStatement; sql: string }
>();

async function timed<T>(label: string, execute: () => Promise<T>): Promise<T> {
	const start = performance.now();
	try {
		return await execute();
	} finally {
		console.log(`[db] ${(performance.now() - start).toFixed(2)}ms ${label}`);
	}
}

function wrapStatement(statement: D1PreparedStatement, sql: string): D1PreparedStatement {
	const wrapped = new Proxy(statement, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			if (property === 'bind') {
				return (...values: unknown[]) => wrapStatement(target.bind(...values), sql);
			}
			if (['all', 'first', 'raw', 'run'].includes(String(property))) {
				return (...args: unknown[]) =>
					timed(`${String(property)} ${sql}`, () => value.apply(target, args));
			}
			return typeof value === 'function' ? value.bind(target) : value;
		}
	});
	statements.set(wrapped, { original: statement, sql });
	return wrapped;
}

// Time execution at the D1 boundary so this also covers Drizzle relational queries and batches.
export function withDatabaseTiming<T extends D1Database | D1DatabaseSession>(database: T): T {
	return new Proxy(database, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			if (typeof value !== 'function') return value;
			if (property === 'prepare') {
				return (sql: string) => wrapStatement(target.prepare(sql), sql);
			}
			if (property === 'batch') {
				return (batch: D1PreparedStatement[]) => {
					const originals = batch.map(
						(statement) => statements.get(statement)?.original ?? statement
					);
					const queries = batch.map(
						(statement) => statements.get(statement)?.sql ?? 'SQL unavailable'
					);
					return timed(`batch (${batch.length} statements) ${queries.join('; ')}`, () =>
						target.batch(originals)
					);
				};
			}
			if (property === 'withSession') {
				return (...args: unknown[]) => withDatabaseTiming(value.apply(target, args));
			}
			if (property === 'exec' || property === 'dump') {
				return (...args: unknown[]) =>
					timed(`${String(property)} ${args[0] ?? ''}`, () => value.apply(target, args));
			}
			return value.bind(target);
		}
	});
}
