import * as dotenv from 'dotenv';
import { Octokit } from '@octokit/rest';
import { createOctokit } from './lib/github-client';
import { writeJsonFile } from './lib/utils';
import { Repository } from './lib/types';

dotenv.config();

const ORGANIZATIONS = ['knative', 'knative-extensions'];

/**
 * Maps a GitHub API repository object to our Repository type
 */
function mapGitHubRepoToRepository(repo: any, organization: string): Repository {
  return {
    name: repo.name,
    fullName: repo.full_name,
    organization,
    description: repo.description,
    url: repo.html_url,
    createdAt: repo.created_at || null,
    updatedAt: repo.updated_at || null,
    pushedAt: repo.pushed_at || null,
    isArchived: repo.archived || false,
    isFork: repo.fork || false,
    defaultBranch: repo.default_branch || null,
  };
}

/**
 * Fetches all repositories from a GitHub organization
 */
async function fetchRepositoriesFromOrg(
  octokit: Octokit,
  organization: string
): Promise<Repository[]> {
  console.log(`Fetching repositories from ${organization}...`);

  const repos = await octokit.paginate(octokit.rest.repos.listForOrg, {
    org: organization,
    per_page: 100,
    type: 'all',
  });

  console.log(`Found ${repos.length} repositories in ${organization}`);

  return repos.map(repo => mapGitHubRepoToRepository(repo, organization));
}

/**
 * Fetches repositories from multiple organizations
 */
async function fetchRepositoriesFromOrgs(
  octokit: Octokit,
  organizations: string[]
): Promise<Repository[]> {
  const allRepos: Repository[] = [];

  for (const org of organizations) {
    try {
      const repos = await fetchRepositoriesFromOrg(octokit, org);
      allRepos.push(...repos);
    } catch (error) {
      console.error(`Error fetching repositories from ${org}:`, error);
      throw error;
    }
  }

  return allRepos;
}

/**
 * Sorts repositories alphabetically by full name
 */
function sortRepositories(repos: Repository[]): Repository[] {
  return repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

async function main() {
  const startTime = Date.now();
  console.log('Step 1: Fetching repository list...\n');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN environment variable is not set');
    process.exit(1);
  }

  const octokit = createOctokit(token);

  // Fetch all repositories
  const allRepos = await fetchRepositoriesFromOrgs(octokit, ORGANIZATIONS);

  // Sort alphabetically by full name
  const sortedRepos = sortRepositories(allRepos);

  // Save to file
  const outputPath = 'data/repos.json';
  writeJsonFile(outputPath, sortedRepos);

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✓ Successfully fetched ${sortedRepos.length} repositories`);
  console.log(`✓ Saved to ${outputPath}`);
  console.log(`✓ Completed in ${duration}s`);
}

main().catch(console.error);
