import * as dotenv from 'dotenv';
import { readJsonFile, writeJsonFile, fileExists, getRepoFileName, getMaxRepos } from './lib/utils';
import { Repository, BotsConfig } from './lib/types';

dotenv.config();

function isBot(username: string | undefined, botsConfig: BotsConfig): boolean {
  if (!username) return false;

  const usernameLower = username.toLowerCase();

  // Check exact matches
  if (botsConfig.exactMatches.some(bot => bot.toLowerCase() === usernameLower)) {
    return true;
  }

  // Check substring matches
  if (botsConfig.substrings.some(substring => usernameLower.includes(substring.toLowerCase()))) {
    return true;
  }

  return false;
}

async function main() {
  const startTime = Date.now();
  console.log('Step 4: Filtering bot activity...\n');

  const repos: Repository[] = readJsonFile('data/repos.json');
  const botsConfig: BotsConfig = readJsonFile('config/bots.json');

  console.log(`Exact bot matches: ${botsConfig.exactMatches.join(', ')}`);
  console.log(`Bot substrings: ${botsConfig.substrings.join(', ')}\n`);

  const maxRepos = getMaxRepos();
  const reposToProcess = maxRepos ? repos.slice(0, maxRepos) : repos;

  console.log(`Processing ${reposToProcess.length} repositories (out of ${repos.length} total)`);
  if (maxRepos) {
    console.log(`MAX_REPOS is set to ${maxRepos}\n`);
  }

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const repo of reposToProcess) {
    if (repo.isArchived) {
      console.log(`[${processed + skipped + 1}/${reposToProcess.length}] Skipping ${repo.fullName} - archived`);
      skipped++;
      continue;
    }

    const activityOutputPath = `data/filtered/activity/${getRepoFileName(repo.organization, repo.name)}`;
    const usageOutputPath = `data/filtered/usage/${getRepoFileName(repo.organization, repo.name)}`;

    console.log(`[${processed + skipped + 1}/${reposToProcess.length}] Processing ${repo.fullName}...`);

    try {
      // Filter activity data
      const activityRawPath = `data/raw/activity/${getRepoFileName(repo.organization, repo.name)}`;
      if (fileExists(activityRawPath)) {
        const activityData: any = readJsonFile(activityRawPath);

        // Filter commits
        const filteredCommits = activityData.commits.filter((commit: any) =>
          !isBot(commit.author?.login, botsConfig) && !isBot(commit.commit?.author?.name, botsConfig)
        );

        // Filter issues
        const filteredIssues = activityData.issues.filter((issue: any) =>
          !isBot(issue.user?.login, botsConfig)
        );

        // Filter pull requests
        const filteredPRs = activityData.pullRequests.filter((pr: any) =>
          !isBot(pr.user?.login, botsConfig)
        );

        // Filter issue comments
        const filteredIssueComments = activityData.issueComments.filter((comment: any) =>
          !isBot(comment.user?.login, botsConfig)
        );

        // Filter PR reviews
        const filteredPRReviews = activityData.prReviews.filter((review: any) =>
          !isBot(review.user?.login, botsConfig)
        );

        // Find latest human activity
        const latestCommit = filteredCommits.length > 0 ? filteredCommits[0] : null;

        const latestIssueComment = filteredIssueComments.length > 0
          ? filteredIssueComments.sort((a: any, b: any) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )[0]
          : null;

        const latestPRReview = filteredPRReviews.length > 0
          ? filteredPRReviews.sort((a: any, b: any) =>
              new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
            )[0]
          : null;

        const filteredActivity = {
          repository: repo.fullName,
          fetchedAt: activityData.fetchedAt,
          filteredAt: new Date().toISOString(),
          commits: filteredCommits,
          issues: filteredIssues,
          pullRequests: filteredPRs,
          issueComments: filteredIssueComments,
          prReviews: filteredPRReviews,
          contributors: activityData.contributors,
          releases: activityData.releases,
          latestHumanActivity: {
            latestCommit: latestCommit ? {
              date: latestCommit.commit?.author?.date,
              author: latestCommit.author?.login || latestCommit.commit?.author?.name,
              sha: latestCommit.sha,
            } : null,
            latestIssueComment: latestIssueComment ? {
              date: latestIssueComment.created_at,
              author: latestIssueComment.user?.login,
              bodyPreview: latestIssueComment.body?.substring(0, 100),
              htmlUrl: latestIssueComment.html_url,
            } : null,
            latestPRReview: latestPRReview ? {
              date: latestPRReview.submitted_at,
              author: latestPRReview.user?.login,
              state: latestPRReview.state,
              htmlUrl: latestPRReview.html_url,
            } : null,
          },
        };

        writeJsonFile(activityOutputPath, filteredActivity);
        console.log(`  ✓ Filtered activity (${filteredCommits.length} commits, ${filteredIssues.length} issues, ${filteredPRs.length} PRs)`);
      }

      // Copy usage data as-is (no filtering needed)
      const usageRawPath = `data/raw/usage/${getRepoFileName(repo.organization, repo.name)}`;
      if (fileExists(usageRawPath)) {
        const usageData: any = readJsonFile(usageRawPath);
        writeJsonFile(usageOutputPath, usageData);
      }

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
