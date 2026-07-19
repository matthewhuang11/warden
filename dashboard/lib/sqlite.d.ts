declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  interface StatementSync {
    run(parameters?: Record<string, unknown>): unknown;
    all(parameters?: Record<string, unknown>): unknown[];
  }
}
