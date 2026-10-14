import type { Server } from 'node:http';

export function startDemoServer(port?: number): Promise<{ server: Server; origin: string }>;
