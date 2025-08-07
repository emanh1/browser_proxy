import { Cluster } from 'puppeteer-cluster';
import puppeteer from 'puppeteer';

let cluster: Cluster | null = null;

export async function getBrowserCluster(): Promise<Cluster> {
  if (cluster) return cluster;

  cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_PAGE,
    maxConcurrency: Number(process.env.CLUSTER_MAX_CONCURRENCY) || 6,
    puppeteer,
    puppeteerOptions: {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        // '--single-process',
      ],
    },
    timeout: 60 * 1000,
    monitor: process.env.REQ_DEBUG === 'true' ? true : false,
  });

  return cluster;
}
