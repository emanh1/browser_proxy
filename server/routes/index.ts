import { getBrowserCluster } from '@/utils/browserCluster';
import {
  createTokenIfNeeded,
  isAllowedToMakeRequest,
  setTokenHeader,
} from '@/utils/turnstile';
import { sendJson } from '~/utils/sending';

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
  if (process.env.REQ_DEBUG === 'true') console.log({
    type: 'browser_request',
    url: destination,
    headers: getHeaders(event)
  });
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

    const waitUntil = getHeader(event, 'x-browser-wait-until') ?? 'networkidle2';
    const timeoutStr = getHeader(event, 'x-browser-timeout');
    const timeout = timeoutStr && /^\d+$/.test(timeoutStr) ? parseInt(timeoutStr) : 30000;

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

    const token = await createTokenIfNeeded(event);
    event.node.res.setHeader('Access-Control-Allow-Origin', '*');
    event.node.res.setHeader('X-Proxy-Mode', 'browser');
    if (token) setTokenHeader(event, token);

    return await send(event, html, 'text/html');
  } catch (error) {
    console.error('[Cluster Error]', error);
    event.node.res.statusCode = 504;
    return sendJson({ event, status: 504, data: { error: 'Browser cluster failed or timed out' } });
  }
});
