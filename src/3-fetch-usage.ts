import * as dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';
import { createOctokit } from './lib/github-client';
import { readJsonFile, writeJsonFile, shouldSkipExistingFile, getRepoFileName, getMaxRepos, shouldForceRefetch } from './lib/utils';
import { Repository } from './lib/types';

dotenv.config();

/**
 * Fetches repository details including stars, forks, watchers, etc.
 */
async function fetchRepositoryDetails(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<any> {
  const { data } = await octokit.rest.repos.get({
    owner,
    repo,
  });
  return data;
}

/**
 * Attempts to fetch traffic data (views and clones)
 * Returns null if not available (requires push access)
 */
async function fetchTrafficData(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<any | null> {
  try {
    const [views, clones] = await Promise.all([
      octokit.rest.repos.getViews({ owner, repo, per: 'week' }),
      octokit.rest.repos.getClones({ owner, repo, per: 'week' }),
    ]);

    return {
      views: views.data,
      clones: clones.data,
    };
  } catch (err) {
    // Traffic data not available (requires push access)
    return null;
  }
}

/**
 * Builds the usage data object from repository details and traffic data
 */
function buildUsageData(
  repoFullName: string,
  repoDetails: any,
  traffic: any | null
): any {
  return {
    repository: repoFullName,
    fetchedAt: new Date().toISOString(),
    stars: repoDetails.stargazers_count,
    forks: repoDetails.forks_count,
    watchers: repoDetails.watchers_count,
    openIssues: repoDetails.open_issues_count,
    subscribers: repoDetails.subscribers_count,
    networkCount: repoDetails.network_count,
    traffic,
  };
}

/**
 * Fetches all usage data for a single repository
 */
async function fetchRepositoryUsage(
  octokit: Octokit,
  repo: Repository
): Promise<any> {
  const [owner, repoName] = repo.fullName.split('/');

  // Fetch repository details and traffic data in parallel
  const [repoDetails, traffic] = await Promise.all([
    fetchRepositoryDetails(octokit, owner, repoName),
    fetchTrafficData(octokit, owner, repoName),
  ]);

  return buildUsageData(repo.fullName, repoDetails, traffic);
}

async function main() {
  const startTime = Date.now();
  console.log('Step 3: Fetching usage metrics...\n');

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

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const repo of reposToProcess) {
    const outputPath = `data/raw/usage/${getRepoFileName(repo.organization, repo.name)}`;

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
      const usageData = await fetchRepositoryUsage(octokit, repo);

      writeJsonFile(outputPath, usageData);
      console.log(`  ✓ Saved usage data (${usageData.stars} stars, ${usageData.forks} forks)`);
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
