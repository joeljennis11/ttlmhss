import { PGlite } from '@electric-sql/pglite';
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from 'kysely';

/**
 * TEST-ONLY Kysely dialect backed by PGlite (PostgreSQL compiled to WebAssembly, in-process).
 * Lets the suite prove that migrations, constraints and repositories behave identically on
 * PostgreSQL without needing a PostgreSQL server. Production PostgreSQL uses the standard `pg`
 * driver (src/data/kysely/connection.ts), which produces the same SQL via the same compiler.
 */
class PgliteConnection implements DatabaseConnection {
  constructor(private readonly pg: PGlite) {}

  async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.pg.query<R>(compiled.sql, [...compiled.parameters]);
    return {
      rows: result.rows,
      ...(result.affectedRows !== undefined && result.affectedRows > 0
        ? { numAffectedRows: BigInt(result.affectedRows) }
        : {}),
    };
  }

  // eslint-disable-next-line require-yield
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('streaming is not supported by the PGlite test dialect');
  }
}

class PgliteDriver implements Driver {
  private readonly connection: PgliteConnection;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly pg: PGlite) {
    this.connection = new PgliteConnection(pg);
  }

  async init(): Promise<void> {}

  // PGlite is a single connection: serialise access like a pool of size one.
  private release: (() => void) | null = null;
  async acquireConnection(): Promise<DatabaseConnection> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    this.release = release;
    return this.connection;
  }

  async beginTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('begin'));
  }
  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('commit'));
  }
  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('rollback'));
  }
  async releaseConnection(): Promise<void> {
    const release = this.release;
    this.release = null;
    release?.();
  }
  async destroy(): Promise<void> {
    await this.pg.close();
  }
}

export class PgliteTestDialect implements Dialect {
  constructor(private readonly pg: PGlite = new PGlite()) {}
  createAdapter() {
    return new PostgresAdapter();
  }
  createDriver() {
    return new PgliteDriver(this.pg);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIntrospector(db: Kysely<any>) {
    return new PostgresIntrospector(db);
  }
  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}
