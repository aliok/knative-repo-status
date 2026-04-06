# Knative Repository Data Collection

Tool to collect comprehensive data about Knative repositories for health analysis.

## Overview

This toolset collects data from Knative repositories across `knative` and `knative-extensions` organizations, focusing on 2026 activity and filtering out bot contributions. The final output is a CSV file for manual analysis.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with your GitHub token:
```bash
cp .env.example .env
# Edit .env and add your GITHUB_TOKEN
```

3. (Optional) Configure bot accounts to filter in `config/bots.json`

## Usage

Run the scripts in order:

```bash
# Step 1: Fetch repository list (2 API calls)
npm run step1

# Step 2: Fetch activity data for each repo (5-6 API calls per repo)
npm run step2

# Step 3: Fetch usage metrics for each repo (1-2 API calls per repo)
npm run step3

# Step 4: Filter bot activity from raw data
npm run step4

# Step 5: Export everything to CSV
npm run step5

# Step 6: Generate interactive HTML report
npm run step6
```

### Testing with Limited Repos

Set `MAX_REPOS=5` in your `.env` file to process only the first 5 repositories (alphabetically) for testing:

```bash
# In .env file
MAX_REPOS=5
```

### Force Re-fetching Data

By default, steps 2-4 skip repositories that already have data files (resumability). To force re-fetching data even for existing files:

```bash
# In .env file
FORCE_REFETCH=true
```

Or run a single command with force refetch:

```bash
FORCE_REFETCH=true npm run step2
```

This is useful when:
- You want to get fresh data for all repositories
- GitHub data has been updated since last fetch
- You want to test changes to the fetching logic

## Data Flow

- **Step 1** → `data/repos.json` (sorted alphabetically)
- **Steps 2-3** → `data/raw/{activity,usage}/{org}__{repo}.json`
- **Step 4** → `data/filtered/{activity,usage}/{org}__{repo}.json`
- **Step 5** → `data/output.csv`
- **Step 6** → `data/report.html`

## Resumability

All steps (2-5) are resumable:
- Each step checks if output files already exist
- If a file exists, that repository is skipped
- You can stop and restart at any time

This is useful when:
- Rate limits are hit
- Network errors occur
- You want to process repositories incrementally

## Features

- **2025-2026 Data**: All activity metrics are limited to 2025-2026 (since 2025-01-01)
- **Bot Filtering**: Automatically filters out bot activity based on `config/bots.json` with exact matches and substring matching
- **Archived Repos Skipped**: Archived repositories are automatically skipped in steps 2-5
- **Alphabetical Order**: Processes repositories in consistent alphabetical order
- **Per-Repo Files**: Saves raw data per repository for easy inspection
- **Resumability**: Steps 2-4 skip already-processed repos; can be overridden with `FORCE_REFETCH`
- **Rate Limit Handling**: Automatic retry and throttling via Octokit plugins

## Bot Filtering Configuration

The `config/bots.json` file controls which accounts are filtered out from activity metrics:

```json
{
  "exactMatches": [
    "knative-prow-robot",
    "googlebot"
  ],
  "substrings": [
    "[bot]"
  ]
}
```

- **exactMatches**: Usernames that must match exactly (case-insensitive)
- **substrings**: Text that must appear anywhere in the username (case-insensitive)
  - Example: `"[bot]"` will filter out `dependabot[bot]`, `github-actions[bot]`, `renovate[bot]`, etc.

All commits, issues, PRs, comments, and reviews from filtered accounts are excluded from the analysis.

## Output Files

### HTML Report (data/report.html)

An interactive HTML report with:
- **Repository list** with direct links to GitHub
- **Usage metrics**: Stars, forks
- **Issues metrics** (2025-2026, bots filtered):
  - Issues opened (links to GitHub showing issues created since 2025-01-01)
  - Issues closed (links to GitHub showing issues closed since 2025-01-01)
  - Note: GitHub's REST API doesn't distinguish "resolved" vs "closed as not planned"
- **Activity metrics**:
  - Open PRs
  - Commits in last 30 days (links to GitHub commits page)
- **Latest human activity**: Last commit, issue comment, and PR review with:
  - Direct links to the specific commits/comments/reviews
  - Author names
  - Relative time (e.g., "3 days ago")
  - 🔍 Verify links to GitHub search to confirm the data
- **Quick links**: Direct links to commits, issues, and PRs pages
- **Summary statistics**: Total repos, active repos, archived repos

Open the report: `open data/report.html`

### CSV Export (data/output.csv)

The CSV file includes:
- **Repository metadata**: Name, organization, URL, last pushed date
- **Usage metrics**: Stars, forks, watchers, open issues
- **Activity metrics (2025-2026)**: Commits counts, PRs, issues
- **Latest human activity**: Last commit date/author, latest issue comment, latest PR review (all marked as "Human" to indicate bot activity is filtered out)
- **Release information**: Latest release date, days since last release
- **Traffic data**: Views and clones (if available with proper permissions)

Note: All "Human" columns exclude bot activity as configured in `config/bots.json` using both exact matches and substring filtering

## GitHub Pages

The HTML report is automatically copied to `docs/index.html` for easy hosting with GitHub Pages.

To enable GitHub Pages:
1. Push your code to GitHub
2. Go to your repository Settings → Pages
3. Under "Source", select "Deploy from a branch"
4. Under "Branch", select `main` (or your default branch) and `/docs` folder
5. Click "Save"

Your report will be available at: `https://<username>.github.io/<repository>/`

The report automatically includes a `.nojekyll` file to prevent Jekyll processing.

## Performance

For ~100 Knative repositories:
- Full run: ~25-35 minutes
- With MAX_REPOS=5: ~2-3 minutes

## Rate Limits

- Uses ~700-900 GitHub API requests for full run
- Well within 5,000 requests/hour limit (authenticated)
- Automatic throttling and retry built-in
