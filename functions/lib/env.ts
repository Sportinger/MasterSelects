export interface AppD1Statement {
  bind(...values: unknown[]): AppD1Statement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  raw<T = unknown[]>(): Promise<T[]>;
  run(): Promise<unknown>;
}

export interface AppD1Database {
  batch<T = unknown>(statements: AppD1Statement[]): Promise<T[]>;
  exec(query: string): Promise<unknown>;
  prepare(query: string): AppD1Statement;
}

export interface AppKVNamespace {
  delete(key: string): Promise<void>;
  get<T = string>(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<T | null>;
  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ keys: { name: string; expiration?: number; metadata?: unknown }[]; list_complete: boolean; cursor?: string }>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: { expiration?: number; expirationTtl?: number; metadata?: unknown },
  ): Promise<void>;
}

export interface AppR2Bucket {
  delete(key: string): Promise<void>;
  get(key: string): Promise<unknown>;
  head(key: string): Promise<unknown>;
  put(key: string, value: unknown, options?: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  ANTHROPIC_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  DB: AppD1Database;
  ENVIRONMENT?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  KIEAI_API_KEY?: string;
  KV: AppKVNamespace;
  MEDIA: AppR2Bucket;
  OPENAI_API_KEY?: string;
  PIAPI_API_KEY?: string;
  RESEND_API_KEY?: string;
  SESSION_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  STRIPE_PRICE_ID_PRO?: string;
  STRIPE_PRICE_ID_STARTER?: string;
  STRIPE_PRICE_ID_STUDIO?: string;
  STRIPE_PRICE_PRO?: string;
  STRIPE_PRICE_STARTER?: string;
  STRIPE_PRICE_STUDIO?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  VISITOR_NOTIFY_SECRET?: string;
}

export interface AppUser {
  email: string;
  id: string;
}

export interface AppContextData {
  requestId?: string;
  user?: AppUser | null;
}

export interface AppContext {
  data: AppContextData;
  env: Env;
  next(input?: Request | string, init?: RequestInit): Promise<Response>;
  params: Record<string, string>;
  request: Request;
  waitUntil(promise: Promise<unknown>): void;
}

export type AppRouteHandler = (context: AppContext) => Promise<Response> | Response;
