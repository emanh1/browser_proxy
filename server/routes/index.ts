import {
  createTokenIfNeeded,
  isAllowedToMakeRequest,
  setTokenHeader,
} from '@/utils/turnstile';
import { sendJson } from '~/utils/sending';
import puppeteer from 'puppeteer';

let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({ headless: true });
    console.log('Puppeteer initialized');
  }
  return browser;
}

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
    return sendError(event, createError({
      statusCode: 400,
      statusMessage: 'Destination required'
    }))
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

  let page = null;
  try {
    const then = Date.now();
    const browser = await getBrowser();
    page = await browser.newPage();
    const token = await createTokenIfNeeded(event);
    const allowedWaitUntil = ['networkidle2', 'domcontentloaded'];

    const waitUntil = getHeader(event, 'x-browser-wait-until') ?? 'networkidle2';

    if (!allowedWaitUntil.includes(waitUntil)) {
      return await sendJson({
        event,
        status: 400,
        data: {
          error: `Invalid waitUntil, only ${allowedWaitUntil.join(', ')}`
        }
      })
    }

    const timeoutStr = getHeader(event, 'x-browser-timeout');
    const timeout = timeoutStr && /^\d+$/.test(timeoutStr) ? parseInt(timeoutStr) : 30000;

    await page.goto(destination, {
      waitUntil: waitUntil as 'networkidle2' | 'domcontentloaded',
      timeout
    });

    const content = await page.content();

    await page.close();
    if (process.env.REQ_DEBUG) console.log("[Browser] Took", Date.now() - then, 'ms');
    event.node.res.setHeader('Access-Control-Allow-Origin', '*');
    event.node.res.setHeader('X-Proxy-Mode', 'browser');
    if (token) setTokenHeader(event, token);
    return await send(event, content, 'text/html');
  } catch (error) {
    if (page) await page.close();
    console.log(error);
    event.node.res.statusCode = 504;
    return sendJson({ event, status: 504, data: { error: 'Puppeteer failed or timed out' } })
  }

});