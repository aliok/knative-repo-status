import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';

const MyOctokit = Octokit.plugin(throttling, retry);

export function createOctokit(token: string): Octokit {
  return new MyOctokit({
    auth: token,
    userAgent: 'knative-repo-status v1.0.0',
    throttle: {
      onRateLimit: (retryAfter: number, options: any) => {
        console.warn(`Rate limit hit. Retrying after ${retryAfter} seconds...`);
        return true; // Auto-retry
      },
      onSecondaryRateLimit: (retryAfter: number, options: any) => {
        console.warn(`Secondary rate limit hit. Retrying after ${retryAfter} seconds...`);
        return true; // Auto-retry
      },
    },
    retry: {
      doNotRetry: [400, 401, 403, 404, 422],
    },
  });
}
