import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { readJsonFile, fileExists, getRepoFileName, getMaxRepos } from './lib/utils';
import { Repository } from './lib/types';

dotenv.config();

function escapeCSV(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getDateDiff(date: string | null): number | null {
  if (!date) return null;
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function main() {
  const startTime = Date.now();
  console.log('Step 5: Exporting to CSV...\n');

  const repos: Repository[] = readJsonFile('data/repos.json');
  const maxRepos = getMaxRepos();
  const reposToProcess = maxRepos ? repos.slice(0, maxRepos) : repos;

  console.log(`Exporting ${reposToProcess.length} repositories (out of ${repos.length} total)`);
  if (maxRepos) {
    console.log(`MAX_REPOS is set to ${maxRepos}\n`);
  }

  const rows: string[] = [];

  // CSV Header
  const headers = [
    'Repository Name',
    'Organization',
    'URL',
    'Last Pushed Date',
    'Stars',
    'Forks',
    'Watchers',
    'Open Issues',
    'Commits (2025-2026)',
    'Commits (Last 30d)',
    'Commits (Last 90d)',
    'Last Commit Date (Human)',
    'Last Commit Author (Human)',
    'Contributors Total',
    'Latest Release Date',
    'Days Since Last Release',
    'PRs Currently Open',
    'PRs Merged (All Time)',
    'Issues Currently Open',
    'Issues Closed (All Time)',
    'Issues Opened (2025-2026)',
    'Issues Closed (2025-2026)',
    'PRs Opened (2025-2026)',
    'PRs Merged (2025-2026)',
    'Latest Issue Comment Date (Human)',
    'Latest Issue Comment Author (Human)',
    'Latest PR Review Date (Human)',
    'Latest PR Review Author (Human)',
    'Traffic Views',
    'Traffic Clones',
  ];

  rows.push(headers.map(escapeCSV).join(','));

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const repo of reposToProcess) {
    if (repo.isArchived) {
      console.log(`[${processed + skipped + 1}/${reposToProcess.length}] Skipping ${repo.fullName} - archived`);
      skipped++;
      continue;
    }

    console.log(`[${processed + skipped + 1}/${reposToProcess.length}] Exporting ${repo.fullName}...`);

    try {
      const activityPath = `data/filtered/activity/${getRepoFileName(repo.organization, repo.name)}`;
      const usagePath = `data/filtered/usage/${getRepoFileName(repo.organization, repo.name)}`;

      const activity: any = fileExists(activityPath) ? readJsonFile(activityPath) : null;
      const usage: any = fileExists(usagePath) ? readJsonFile(usagePath) : null;

      // Calculate metrics
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      const commitsTotal = activity?.commits?.length || 0;
      const commits30d = activity?.commits?.filter((c: any) =>
        new Date(c.commit?.author?.date) >= thirtyDaysAgo
      ).length || 0;
      const commits90d = activity?.commits?.filter((c: any) =>
        new Date(c.commit?.author?.date) >= ninetyDaysAgo
      ).length || 0;

      const lastCommit = activity?.latestHumanActivity?.latestCommit;
      const latestIssueComment = activity?.latestHumanActivity?.latestIssueComment;
      const latestPRReview = activity?.latestHumanActivity?.latestPRReview;

      // All-time / current state metrics
      const prsOpen = activity?.pullRequests?.filter((pr: any) => pr.state === 'open').length || 0;
      const prsMergedAllTime = activity?.pullRequests?.filter((pr: any) => pr.merged_at).length || 0;
      const issuesOpen = activity?.issues?.filter((i: any) => i.state === 'open').length || 0;
      const issuesClosedAllTime = activity?.issues?.filter((i: any) => i.state === 'closed').length || 0;

      // 2025-2026 filtered metrics
      const sinceDate = new Date('2025-01-01T00:00:00Z');
      const issuesOpened2025 = activity?.issues?.filter((i: any) =>
        new Date(i.created_at) >= sinceDate
      ).length || 0;
      const issuesClosed2025 = activity?.issues?.filter((i: any) =>
        i.closed_at && new Date(i.closed_at) >= sinceDate
      ).length || 0;
      const prsOpened2025 = activity?.pullRequests?.filter((pr: any) =>
        new Date(pr.created_at) >= sinceDate
      ).length || 0;
      const prsMerged2025 = activity?.pullRequests?.filter((pr: any) =>
        pr.merged_at && new Date(pr.merged_at) >= sinceDate
      ).length || 0;

      const latestRelease = activity?.releases?.[0];
      const daysSinceRelease = latestRelease
        ? getDateDiff(latestRelease.published_at || latestRelease.created_at)
        : null;

      const row = [
        repo.name,
        repo.organization,
        repo.url,
        repo.pushedAt,
        usage?.stars || 0,
        usage?.forks || 0,
        usage?.watchers || 0,
        usage?.openIssues || 0,
        commitsTotal,
        commits30d,
        commits90d,
        lastCommit?.date || '',
        lastCommit?.author || '',
        activity?.contributors?.length || 0,
        latestRelease?.published_at || latestRelease?.created_at || '',
        daysSinceRelease !== null ? daysSinceRelease : '',
        prsOpen,
        prsMergedAllTime,
        issuesOpen,
        issuesClosedAllTime,
        issuesOpened2025,
        issuesClosed2025,
        prsOpened2025,
        prsMerged2025,
        latestIssueComment?.date || '',
        latestIssueComment?.author || '',
        latestPRReview?.date || '',
        latestPRReview?.author || '',
        usage?.traffic?.views?.count || '',
        usage?.traffic?.clones?.count || '',
      ];

      rows.push(row.map(escapeCSV).join(','));
      processed++;

    } catch (error: any) {
      console.error(`  ✗ Error exporting ${repo.fullName}:`, error.message);
      errors++;
    }
  }

  // Write CSV file
  const outputPath = 'data/output.csv';
  fs.writeFileSync(outputPath, rows.join('\n'), 'utf-8');

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n✓ Exported: ${processed} repositories`);
  console.log(`✓ Skipped: ${skipped}`);
  console.log(`✗ Errors: ${errors}`);
  console.log(`✓ Saved to ${outputPath}`);
  console.log(`✓ Completed in ${duration}s`);
}

main().catch(console.error);
