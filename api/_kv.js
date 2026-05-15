import { Redis } from '@upstash/redis';

// Support both env var conventions (legacy KV_* and new UPSTASH_*)
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  console.warn('[stockly] Missing Redis env vars. Expected KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN');
}

export const kv = new Redis({ url, token });
