import { getAllowedDomains } from "~/utils/whitelist";

function isInternalHost(host: string) {
  return (
    host === 'localhost' ||
    host.startsWith('127.') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  );
}

export default defineEventHandler(async (event) => {
  const destination = getQuery<{ destination?: string }>(event).destination;
  if (destination) {
    let hostname: string;
    try {
      const url = new URL(destination);
      hostname = url.hostname;
    } catch {
      throw createError({ statusCode: 400, statusMessage: 'Invalid URL' })
    }

    if (isInternalHost(hostname)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
    }

    if (process.env.WHITELIST_MODE === 'true') {
      const allowedDomains = await getAllowedDomains();
      if (!allowedDomains.some(domain => hostname.endsWith(domain))) {
        throw createError({ statusCode: 403, statusMessage: `Forbidden ${hostname}` });
      }
    }
  }
});
