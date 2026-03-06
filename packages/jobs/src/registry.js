import { runDailyCryptoBrief } from './tasks/daily-crypto-brief.js';

export async function runJob(jobType, input, ctx = {}) {
  switch (jobType) {
    case 'daily-crypto-brief':
      return runDailyCryptoBrief(input, ctx);
    case 'ping':
      return { summary: 'pong', input, ctx };
    default:
      throw new Error(`Unsupported jobType: ${jobType}`);
  }
}
