import Redis from 'ioredis';
import crypto from 'crypto';

const redis = new Redis({
  host: 'redis',
  port: 6379,
  password: process.env.REDIS_PASSWORD,
});

export function getCacheKey(destination: string, waitUntil: string, timeout: string) {
  const keyString = `${destination}_${waitUntil}_${timeout}`;
  const hash = crypto.createHash('sha256').update(keyString).digest('hex');
  return `proxy_cache:${hash}`;
}

export default redis;