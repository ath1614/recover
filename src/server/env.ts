/** The slice of the Workers runtime this service uses, declared locally so the browser build
 * never pulls in workers-types globals. */

export interface D1Result<T> {
  results: T[];
  success: boolean;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
}

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(input: Request | string): Promise<Response> };
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  salt: string;
  is_demo: number;
  created_at: number;
}

export interface InvoiceRow {
  id: string;
  user_id: string;
  customer: string;
  email: string;
  amount: number;
  currency: string;
  status: string;
  attempts: number;
  next_attempt_at: number | null;
  reason: string;
  created_at: number;
  updated_at: number;
}

export interface EventRow {
  id: string;
  user_id: string;
  invoice_id: string | null;
  kind: string;
  detail: string;
  created_at: number;
}
