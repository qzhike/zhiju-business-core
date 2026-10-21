import type pg from 'pg';

export function trackPoolShutdown(pool: pg.Pool): { end(): Promise<void> };
