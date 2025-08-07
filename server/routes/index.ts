import { getBrowserCluster } from '@/utils/browserCluster';
import {
  createTokenIfNeeded,
  isAllowedToMakeRequest,
  setTokenHeader,
} from '@/utils/turnstile';
import { sendJson } from '~/utils/sending';
import redis, { getCacheKey } from '~/utils/redis';

export default defineEventHandler(async (event) => {
  // Handle preflight CORS requests
  if (isPreflightRequest(event)) {
    handleCors(event, {});
    // Ensure the response ends here for preflight
    event.node.res.statusCode = 204;
    event.node.res.end();
    return;
  }

  // Reject any other OPTIONS requests
  if (event.node.req.method === 'OPTIONS') {
    throw createError({
      statusCode: 405,
      statusMessage: 'Method Not Allowed',
    });
  }

  // Parse destination URL
  const destination = getQuery<{ destination?: string }>(event).destination;
  if (!destination) {
    try {
      const cluster = await getBrowserCluster();

      // Test a simple blank page to confirm it's responsive
      await cluster.execute(async ({ page }) => {
        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });
      });

      return sendJson({ event, status: 200, data: { status: `Browser cluster OK. v${useRuntimeConfig(event).version}` } });
    } catch (error) {
      console.error('Health check failed:', error);
      event.node.res.statusCode = 503;
      return sendJson({ event, status: 503, data: { error: 'Browser cluster not ready' } });
    }
  }

  const waitUntil = getHeader(event, 'x-browser-wait-until') ?? 'networkidle2';
  const timeoutStr = getHeader(event, 'x-browser-timeout') ?? '30000';
  const timeout = timeoutStr && /^\d+$/.test(timeoutStr) ? parseInt(timeoutStr) : 30000;

  const cacheKey = getCacheKey(encodeURIComponent(destination), waitUntil, timeoutStr);

  try {
    const cachedHtml = await redis.get(cacheKey);
    if (cachedHtml) {
      if (process.env.REQ_DEBUG === 'true') console.log(`Cache hit for ${destination} ${cacheKey}`);
      event.node.res.setHeader('Access-Control-Allow-Origin', '*');
      event.node.res.setHeader('X-Proxy-Mode', 'browser-cache');
      event.node.res.setHeader('X-Cache-Status', 'HIT');

      return await send(event, cachedHtml, 'text/html');
    }
  } catch (err) {
    console.log('[Redis] Get error', err);
  }

  // Check if allowed to make the request
  if (!(await isAllowedToMakeRequest(event))) {
    return await sendJson({
      event,
      status: 401,
      data: {
        error: 'Invalid or missing token',
      },
    });
  }

  try {
    const cluster = await getBrowserCluster();

    const html = await cluster.execute({
      url: destination,
      waitUntil,
      timeout
    }, async ({ page, data }) => {
      const { url, waitUntil, timeout } = data;
      await page.goto(url, {
        waitUntil: waitUntil as 'networkidle2' | 'domcontentloaded',
        timeout,
      });
      return await page.content();
    });

    try {
      await redis.set(cacheKey, html, 'EX', process.env.REDIS_TTL ? Number(process.env.REDIS_TTL) : 300);
    } catch (error) {
      console.log('[Redis] Set error', error);
    }

    const token = await createTokenIfNeeded(event);
    event.node.res.setHeader('Access-Control-Allow-Origin', '*');
    event.node.res.setHeader('X-Proxy-Mode', 'browser');
    event.node.res.setHeader('X-Cache-Status', 'MISS');

    if (token) setTokenHeader(event, token);

    return await send(event, html, 'text/html');
  } catch (error) {
    console.error('[Cluster Error]', error);
    event.node.res.statusCode = 504;
    return sendJson({ event, status: 504, data: { error: 'Browser cluster failed or timed out' } });
  }
});
