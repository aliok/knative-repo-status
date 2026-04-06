import * as dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';
import { createOctokit } from './lib/github-client';
import { readJsonFile, writeJsonFile, shouldSkipExistingFile, getRepoFileName, getMaxRepos, shouldForceRefetch } from './lib/utils';
import { Repository, BotsConfig } from './lib/types';

dotenv.config();

const SINCE_DATE = '2025-01-01T00:00:00Z';

/**
 * Creates a function that checks if a username belongs to a bot
 */
function createBotChecker(botsConfig: BotsConfig): (username: string | undefined) => boolean {
  return function isBot(username: string | undefined): boolean {
    if (!username) return false;
    const usernameLower = username.toLowerCase();

    if (botsConfig.exactMatches.some((bot: string) => bot.toLowerCase() === usernameLower)) {
      return true;
    }

    if (botsConfig.substrings.some((substring: string) => usernameLower.includes(substring.toLowerCase()))) {
      return true;
    }

    return false;
  };
}

/**
 * Fetches commits since a specific date
 */
async function fetchCommits(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: string
): Promise<any[]> {
  return await octokit.paginate(octokit.rest.repos.listCommits, {
    owner,
    repo,
    since,
    per_page: 100,
  });
}

/**
 * Fetches issues (excluding pull requests) since a specific date
 */
async function fetchIssues(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: string
): Promise<any[]> {
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo,
    since,
    state: 'all',
    per_page: 100,
  });

  // Filter out pull requests from issues (issues API returns both)
  return issues.filter(issue => !issue.pull_request);
}

/**
 * Fetches pull requests created or updated since a specific date
 */
async function fetchPullRequests(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: string
): Promise<any[]> {
  const pullRequests = await octokit.paginate(octokit.rest.pulls.list, {
    owner,
    repo,
    state: 'all',
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
  });

  const sinceDate = new Date(since);
  return pullRequests.filter(pr =>
    new Date(pr.created_at) >= sinceDate ||
    new Date(pr.updated_at) >= sinceDate
  );
}

/**
 * Fetches all contributors for a repository
 */
async function fetchContributors(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<any[]> {
  return await octokit.paginate(octokit.rest.repos.listContributors, {
    owner,
    repo,
    per_page: 100,
  });
}

/**
 * Fetches releases published since a specific date
 */
async function fetchReleases(
  octokit: Octokit,
  owner: string,
  repo: string,
  since: string
): Promise<any[]> {
  const allReleases = await octokit.paginate(octokit.rest.repos.listReleases, {
    owner,
    repo,
    per_page: 100,
  });

  const sinceDate = new Date(since);
  return allReleases.filter(release =>
    new Date(release.published_at || release.created_at) >= sinceDate
  );
}

/**
 * Fetches issue comments, stopping early once we find the latest human comment
 */
async function fetchIssueCommentsUntilLatestHuman(
  octokit: Octokit,
  owner: string,
  repo: string,
  issues: any[],
  isBot: (username: string | undefined) => boolean
): Promise<any[]> {
  const issueComments: any[] = [];

  // Sort issues by updated_at descending (newest first)
  const sortedIssues = [...issues].sort((a, b) =>
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  let latestHumanCommentDate: Date | null = null;

  for (const issue of sortedIssues) {
    // If we found a human comment and this issue was updated before that comment was created,
    // we can stop (this issue can't have any comments newer than what we've already found)
    if (latestHumanCommentDate && new Date(issue.updated_at) < latestHumanCommentDate) {
      break;
    }

    try {
      const comments = await octokit.paginate(octokit.rest.issues.listComments, {
        owner,
        repo,
        issue_number: issue.number,
        per_page: 100,
      });

      issueComments.push(...comments);

      // Track the latest human comment date
      for (const comment of comments) {
        if (!isBot(comment.user?.login) && comment.created_at) {
          const commentDate = new Date(comment.created_at);
          if (!latestHumanCommentDate || commentDate > latestHumanCommentDate) {
            latestHumanCommentDate = commentDate;
          }
        }
      }
    } catch (err) {
      // Continue if comments fetch fails
    }
  }

  return issueComments;
}

/**
 * Fetches PR reviews, stopping early once we find the latest human review
 */
async function fetchPRReviewsUntilLatestHuman(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullRequests: any[],
  isBot: (username: string | undefined) => boolean
): Promise<any[]> {
  const prReviews: any[] = [];

  // Sort PRs by updated_at descending (newest first)
  const sortedPRs = [...pullRequests].sort((a, b) =>
    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

  let latestHumanReviewDate: Date | null = null;

  for (const pr of sortedPRs) {
    // If we found a human review and this PR was updated before that review was submitted,
    // we can stop (this PR can't have any reviews newer than what we've already found)
    if (latestHumanReviewDate && new Date(pr.updated_at) < latestHumanReviewDate) {
      break;
    }

    // Fetch PR reviews
    try {
      const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
      });

      prReviews.push(...reviews);

      // Track the latest human review date
      for (const review of reviews) {
        if (!isBot(review.user?.login) && review.submitted_at) {
          const reviewDate = new Date(review.submitted_at);
          if (!latestHumanReviewDate || reviewDate > latestHumanReviewDate) {
            latestHumanReviewDate = reviewDate;
          }
        }
      }
    } catch (err) {
      // Some PRs might not have reviews API available
    }
  }

  return prReviews;
}

/**
 * Builds the activity data object
 */
function buildActivityData(
  repoFullName: string,
  commits: any[],
  issues: any[],
  pullRequests: any[],
  contributors: any[],
  releases: any[],
  issueComments: any[],
  prReviews: any[]
): any {
  return {
    repository: repoFullName,
    fetchedAt: new Date().toISOString(),
    commits,
    issues,
    pullRequests,
    contributors,
    releases,
    issueComments,
    prReviews,
  };
}

/**
 * Fetches all activity data for a single repository
 */
async function fetchRepositoryActivity(
  octokit: Octokit,
  repo: Repository,
  since: string,
  botsConfig: BotsConfig
): Promise<any> {
  const [owner, repoName] = repo.fullName.split('/');
  const isBot = createBotChecker(botsConfig);

  // Fetch all activity data in parallel where possible
  const [commits, issues, pullRequests, contributors, releases] = await Promise.all([
    fetchCommits(octokit, owner, repoName, since),
    fetchIssues(octokit, owner, repoName, since),
    fetchPullRequests(octokit, owner, repoName, since),
    fetchContributors(octokit, owner, repoName),
    fetchReleases(octokit, owner, repoName, since),
  ]);

  // Fetch comments and reviews sequentially (they depend on issues/PRs and have early stopping)
  const issueComments = await fetchIssueCommentsUntilLatestHuman(
    octokit,
    owner,
    repoName,
    issues,
    isBot
  );

  const prReviews = await fetchPRReviewsUntilLatestHuman(
    octokit,
    owner,
    repoName,
    pullRequests,
    isBot
  );

  return buildActivityData(
    repo.fullName,
    commits,
    issues,
    pullRequests,
    contributors,
    releases,
    issueComments,
    prReviews
  );
}

async function main() {
  const startTime = Date.now();
  console.log('Step 2: Fetching activity metrics...\n');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN environment variable is not set');
    process.exit(1);
  }

  const octokit = createOctokit(token);
  const repos: Repository[] = readJsonFile('data/repos.json');
  const maxRepos = getMaxRepos();
  const reposToProcess = maxRepos ? repos.slice(0, maxRepos) : repos;

  console.log(`Processing ${reposToProcess.length} repositories (out of ${repos.length} total)`);
  if (maxRepos) {
    console.log(`MAX_REPOS is set to ${maxRepos}`);
  }
  if (shouldForceRefetch()) {
    console.log(`FORCE_REFETCH is enabled - will re-fetch all data\n`);
  } else {
    console.log('');
  }

  const botsConfig: BotsConfig = readJsonFile('config/bots.json');
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const repo of reposToProcess) {
    const outputPath = `data/raw/activity/${getRepoFileName(repo.organization, repo.name)}`;

    if (repo.isArchived) {
      console.log(`[${processed + skipped + 1}/${reposToProcess.length}] Skipping ${repo.fullName} - archived`);
      skipped++;
      continue;
    }

    if (shouldSkipExistingFile(outputPath)) {
      console.log(`[${processed + skipped + 1}/${reposToProcess.length}] Skipping ${repo.fullName} - already processed`);
      skipped++;
      continue;
    }

    console.log(`[${processed + skipped + 1}/${reposToProcess.length}] Processing ${repo.fullName}...`);

    try {
      const activityData = await fetchRepositoryActivity(octokit, repo, SINCE_DATE, botsConfig);

      writeJsonFile(outputPath, activityData);
      console.log(`  ✓ Saved activity data (${activityData.commits.length} commits, ${activityData.issues.length} issues, ${activityData.pullRequests.length} PRs)`);
      processed++;

    } catch (error: any) {
      console.error(`  ✗ Error processing ${repo.fullName}:`, error.message);
      errors++;
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✓ Processed: ${processed}`);
  console.log(`✓ Skipped: ${skipped}`);
  console.log(`✗ Errors: ${errors}`);
  console.log(`✓ Completed in ${duration}s`);
}

main().catch(console.error);
