# Knative Repository Data Collection - Implementation Plan

## Context

The Knative project maintains repositories across two GitHub organizations (`knative` and `knative-extensions`). There's a concern that some repositories may be obsolete and should be deprecated - they're being maintained but not actually used by the community.

This toolset will collect comprehensive data about all repositories, exporting the raw metrics to CSV format for manual analysis and decision-making.

## Approach

Build a set of TypeScript scripts that run incrementally, where each step:
1. Reads input from files created in previous steps
2. Fetches data from GitHub API using Octokit
3. Saves results to JSON files for the next step
4. Final step combines all data into a CSV export

This incremental approach allows running steps independently, resuming from failures, and inspecting intermediate results.

## Project Structure

```
knative-repo-status/
├── src/
│   ├── 1-fetch-repos.ts              # Step 1: Fetch repo list
│   ├── 2-fetch-activity.ts           # Step 2: Fetch activity metrics (per repo)
│   ├── 3-fetch-usage.ts              # Step 3: Fetch usage metrics (per repo)
│   ├── 4-fetch-dependencies.ts       # Step 4: Fetch dependency info (per repo)
│   ├── 5-filter-bots.ts              # Step 5: Filter bot activity from all data
│   ├── 6-export-csv.ts               # Step 6: Combine and export to CSV
│   ├── lib/
│   │   ├── github-client.ts          # Octokit initialization
│   │   ├── types.ts                  # TypeScript interfaces
│   │   └── utils.ts                  # Shared utilities
├── data/
│   ├── repos.json                    # Output from step 1 (sorted alphabetically)
│   ├── raw/                          # Raw data per repo (as-is from API)
│   │   ├── activity/
│   │   │   ├── knative__repo1.json
│   │   │   └── knative__repo2.json
│   │   ├── usage/
│   │   │   ├── knative__repo1.json
│   │   │   └── knative__repo2.json
│   │   └── dependencies/
│   │       ├── knative__repo1.json
│   │       └── knative__repo2.json
│   ├── filtered/                     # Filtered data (bots removed)
│   │   ├── activity/
│   │   ├── usage/
│   │   └── dependencies/
│   └── output.csv                    # Final CSV export
├── config/
│   └── bots.json                     # List of bot usernames to filter out
├── package.json
├── tsconfig.json
└── .env
```

## Data Collection Steps

### Step 1: Repository List (data/repos.json)

Makes 2 API calls (one per organization) to list all repositories.

Saves repositories sorted alphabetically by full name (org/repo).

Saves basic repository information from the list endpoint:
- Repository name
- Full name (org/repo)
- Organization
- Description
- URL
- Created date
- Last updated date
- Last pushed date
- Is archived
- Is fork
- Default branch

Note: This step uses only the organization list repositories endpoint - no individual repo API calls.

**Ordering**: Repositories are sorted alphabetically by full name for deterministic processing in later steps.

### Step 2: Activity Metrics (data/raw/activity/)

For each repository (processed in alphabetical order), collects raw activity data from 2026 only (since: 2026-01-01).

Saves one JSON file per repository: `data/raw/activity/{org}__{repo}.json`

Data collected (saved as-is from API, no filtering):
- **Commits** (2026 only): Full commit objects from API
- **Issues** (created/updated in 2026): Full issue objects including all comments
- **Pull Requests** (created/updated in 2026): Full PR objects including all comments and reviews
- **Contributors** (2026 activity): List of all contributors
- **Releases** (2026 only): Full release objects

**Resumability**: Before fetching data for a repo, checks if `data/raw/activity/{org}__{repo}.json` exists. If it does, skips that repo.

**Limiting**: Respects `MAX_REPOS` environment variable - if set to 5, processes only first 5 repos alphabetically.

**No filtering**: Saves complete API responses including bot activity. Filtering happens in Step 5.

### Step 3: Usage Metrics (data/raw/usage/)

For each repository (processed in alphabetical order), collects raw usage data.

Saves one JSON file per repository: `data/raw/usage/{org}__{repo}.json`

Data collected (saved as-is from API):
- Stars count
- Forks count
- Watchers count
- Open issues count
- Subscribers count
- Network count
- Traffic data (views, clones) - if available with proper permissions

**Resumability**: Before fetching data for a repo, checks if `data/raw/usage/{org}__{repo}.json` exists. If it does, skips that repo.

**Limiting**: Respects `MAX_REPOS` environment variable - if set to 5, processes only first 5 repos alphabetically.

### Step 4: Dependency Metrics (data/raw/dependencies/)

For each repository (processed in alphabetical order), collects raw dependency data.

Saves one JSON file per repository: `data/raw/dependencies/{org}__{repo}.json`

Data collected (saved as-is):
- List of Knative repos this depends on (from go.mod, package.json, etc.)
- List of Knative repos that depend on this one
- Cross-references in issues/PRs from other Knative repos

**Resumability**: Before fetching data for a repo, checks if `data/raw/dependencies/{org}__{repo}.json` exists. If it does, skips that repo.

**Limiting**: Respects `MAX_REPOS` environment variable - if set to 5, processes only first 5 repos alphabetically.

### Step 5: Bot Filtering (data/filtered/)

Reads all raw data files and filters out bot activity based on `config/bots.json`.

For each repository, creates filtered versions:
- `data/filtered/activity/{org}__{repo}.json` - Activity data with bot commits, issues, PRs, comments, reviews removed
- `data/filtered/usage/{org}__{repo}.json` - Usage data (copied as-is, no filtering needed)
- `data/filtered/dependencies/{org}__{repo}.json` - Dependencies (copied as-is, no filtering needed)

**Bot filtering logic**:
- Removes commits where author is in bots list
- Removes issues created by bots
- Removes PRs created by bots
- Removes issue/PR comments by bots
- Removes PR reviews by bots
- Recalculates counts and identifies latest human activity

**Resumability**: Before processing a repo, checks if all three filtered files exist. If they do, skips that repo.

**Limiting**: Respects `MAX_REPOS` environment variable.

### Step 6: CSV Export (data/output.csv)

Reads all filtered data files and combines into a single CSV file with columns:
- Repository name
- Organization
- Description
- URL
- Created date
- Last pushed date
- Is archived
- Stars
- Forks
- Watchers
- Open issues
- Commits in 2026 by humans (30d, 90d, since Jan 1)
- Last commit date (by human)
- Last commit author (human)
- Contributors in 2026 (human, total, 30d active, 90d active)
- Latest release date
- Days since last release
- PRs in 2026 by humans (open, closed, merged)
- Issues in 2026 by humans (open, closed)
- Latest issue comment date (by human)
- Latest issue comment author (by human)
- Latest PR comment date (by human)
- Latest PR comment author (by human)
- Latest PR review date (by human)
- Latest PR review author (by human)
- Dependent repos count
- Traffic views (if available)
- Traffic clones (if available)

**Data source**: Reads from `data/filtered/` directory which has bot activity already removed.

**Limiting**: Respects `MAX_REPOS` environment variable - only includes repos that were processed.

## Execution Flow

### Running the Scripts

Each script is run independently using ts-node:

```bash
# Step 1: Fetch repository list (sorted alphabetically)
npx ts-node src/1-fetch-repos.ts

# Step 2: Fetch activity metrics (processes repos in alphabetical order)
MAX_REPOS=5 npx ts-node src/2-fetch-activity.ts

# Step 3: Fetch usage metrics (processes repos in alphabetical order)
MAX_REPOS=5 npx ts-node src/3-fetch-usage.ts

# Step 4: Fetch dependencies (processes repos in alphabetical order)
MAX_REPOS=5 npx ts-node src/4-fetch-dependencies.ts

# Step 5: Filter bot activity from raw data
MAX_REPOS=5 npx ts-node src/5-filter-bots.ts

# Step 6: Export to CSV
MAX_REPOS=5 npx ts-node src/6-export-csv.ts
```

### Data Flow Between Steps

Each step reads from and writes to the data/ directory:
- Step 1 → Creates `data/repos.json` (sorted alphabetically)
- Steps 2-4 → Read `data/repos.json`, create per-repo JSON files in `data/raw/{activity,usage,dependencies}/`
- Step 5 → Reads `data/raw/`, creates per-repo JSON files in `data/filtered/`
- Step 6 → Reads `data/filtered/`, creates `data/output.csv`

**Resumability**: Each step checks if output files already exist and skips processing for those repos.

**Processing order**: All steps process repositories in alphabetical order (by full name).

**Testing with subset**: Set `MAX_REPOS=5` to process only the first 5 repos alphabetically.

This allows:
- Re-running individual steps without repeating earlier work
- Inspecting intermediate results per repository
- Resuming from failures or rate limit issues
- Testing with a small subset before processing all repos

## Configuration

### Environment Variables (.env)

- `GITHUB_TOKEN`: GitHub personal access token (required)
- `MAX_REPOS`: Optional limit on number of repositories to process (e.g., `5` for testing). If not set, processes all repos.

Example `.env`:
```
GITHUB_TOKEN=ghp_your_token_here
MAX_REPOS=5
```

### Bot Filter (config/bots.json)

A JSON file containing usernames of bots to exclude from activity metrics:

```json
{
  "bots": [
    "dependabot[bot]",
    "renovate[bot]",
    "github-actions[bot]",
    "knative-prow-robot",
    "googlebot"
  ]
}
```

This file can be manually edited to add/remove bot accounts. Step 5 filters out activity (commits, issues, PRs, comments, reviews) from these accounts.

## GitHub API Considerations

### Authentication

Required: GitHub personal access token
- Set via `GITHUB_TOKEN` environment variable in `.env` file
- Scope needed: `public_repo` (for public data) or `repo` (for traffic data if you have push access)

### Rate Limiting

GitHub API limits:
- Authenticated: 5,000 requests/hour
- Unauthenticated: 60 requests/hour

Strategies:
- Use Octokit plugins for automatic throttling and retry
- Each script saves progress incrementally
- Can resume from failures without re-fetching completed data
- Process repositories sequentially to avoid overwhelming the API

### Error Handling

Each script should:
- Continue processing remaining repos if one fails
- Log errors with repository context
- Save partial results
- Allow re-running to complete missing data

## Dependencies

**Runtime:**
- `@octokit/rest` - GitHub API client
- `@octokit/plugin-throttling` - Rate limit handling
- `@octokit/plugin-retry` - Automatic retries
- `dotenv` - Environment variable loading

**Development:**
- `typescript` - TypeScript compiler
- `@types/node` - Node.js type definitions
- `ts-node` - Run TypeScript directly

## Implementation Sequence

**Phase 1: Project Setup**
1. Initialize package.json with dependencies
2. Configure TypeScript (tsconfig.json)
3. Create .env.example file
4. Set up data/ directory structure
5. Implement shared utilities (src/lib/github-client.ts, src/lib/types.ts)

**Phase 2: Step-by-Step Scripts**
1. Implement src/1-fetch-repos.ts
   - Initialize Octokit client
   - Fetch repos from both organizations (2 API calls)
   - Sort repos alphabetically by full name
   - Save to data/repos.json

2. Implement src/2-fetch-activity.ts
   - Read data/repos.json
   - Respect MAX_REPOS env var
   - For each repo (in alphabetical order):
     - Check if data/raw/activity/{org}__{repo}.json exists, skip if present
     - Make ~5-6 API calls for 2026 data:
       - List commits (since 2026-01-01)
       - List issues (created/updated in 2026)
       - List pull requests (created/updated in 2026)
       - List contributors
       - List releases (2026)
       - Fetch comments/reviews on issues/PRs
     - Save raw API response to data/raw/activity/{org}__{repo}.json

3. Implement src/3-fetch-usage.ts
   - Read data/repos.json
   - Respect MAX_REPOS env var
   - For each repo (in alphabetical order):
     - Check if data/raw/usage/{org}__{repo}.json exists, skip if present
     - Fetch stars, forks, watchers, traffic
     - Save raw API response to data/raw/usage/{org}__{repo}.json

4. Implement src/4-fetch-dependencies.ts
   - Read data/repos.json
   - Respect MAX_REPOS env var
   - For each repo (in alphabetical order):
     - Check if data/raw/dependencies/{org}__{repo}.json exists, skip if present
     - Analyze dependencies and cross-references
     - Save raw data to data/raw/dependencies/{org}__{repo}.json

5. Implement src/5-filter-bots.ts
   - Read config/bots.json
   - Read data/repos.json
   - Respect MAX_REPOS env var
   - For each repo (in alphabetical order):
     - Check if filtered files exist, skip if present
     - Read raw data files
     - Filter out bot activity from commits, issues, PRs, comments, reviews
     - Calculate human-only metrics and latest human activity
     - Save to data/filtered/{activity,usage,dependencies}/{org}__{repo}.json

6. Implement src/6-export-csv.ts
   - Read data/repos.json
   - Respect MAX_REPOS env var
   - For each repo, read filtered data files
   - Combine all data into CSV rows
   - Export to data/output.csv

## Script Design Patterns

**Each script should:**
1. Load environment variables from .env (GITHUB_TOKEN, MAX_REPOS)
2. Initialize Octokit client with throttling and retry plugins (steps 2-4)
3. Read data/repos.json and process repos in alphabetical order
4. Check MAX_REPOS env var and limit processing if set
5. Check if output file exists before processing (resumability)
6. Process data with progress logging to console (e.g., "Processing 5/100: knative/serving")
7. Handle errors gracefully - log error, save what we have, continue with remaining repos
8. Save results to individual JSON files per repository (not batched)
9. Log summary at completion (total processed, skipped, errors, time taken)

**Resumability pattern:**
```
For each repo in repos (alphabetically):
  outputFile = `data/raw/activity/${org}__${repo}.json`
  if file exists:
    log "Skipping {repo} - already processed"
    continue
  try:
    data = fetchFromAPI(repo)
    saveToFile(outputFile, data)
    log "Completed {repo}"
  catch error:
    log "Error processing {repo}: {error}"
    continue with next repo
```

**Data file format:**
- Use JSON for all intermediate data (easy to inspect and modify)
- Use pretty-printed JSON (readable for debugging)
- Save raw API responses without transformation (steps 2-4)
- Use consistent filename format: `{org}__{repo}.json`

## Verification Checklist

After implementation, verify:
- [ ] Step 1 fetches all repos from both organizations and sorts alphabetically
- [ ] Step 2 saves raw activity data per repo to data/raw/activity/
- [ ] Step 3 saves raw usage data per repo to data/raw/usage/
- [ ] Step 4 saves raw dependency data per repo to data/raw/dependencies/
- [ ] Step 5 filters bot activity and saves to data/filtered/
- [ ] Step 6 exports complete CSV with all metrics
- [ ] MAX_REPOS=5 limits processing to first 5 repos alphabetically
- [ ] Can re-run individual steps - skips already-processed repos
- [ ] If script is interrupted, re-running resumes from where it stopped
- [ ] Errors on one repo don't stop processing of other repos
- [ ] Processing happens in alphabetical order consistently
- [ ] Raw data files contain complete API responses
- [ ] Filtered data files have bot activity removed
- [ ] CSV can be opened in Excel/Google Sheets
- [ ] All dates are properly formatted
- [ ] Rate limits are respected

## Expected Performance

For ~100 Knative repositories (2026 data only):
- Step 1: ~1-2 minutes (2 API calls to list repos from 2 orgs)
- Step 2: ~8-12 minutes (5-6 API calls per repo for 2026 data)
  - With MAX_REPOS=5: ~30-60 seconds
- Step 3: ~3-5 minutes (1-2 API calls per repo for usage stats)
  - With MAX_REPOS=5: ~15-30 seconds
- Step 4: ~10-15 minutes (analyze dependencies across repos)
  - With MAX_REPOS=5: ~30-45 seconds
- Step 5: ~1-2 minutes (filter bot data from all raw files)
  - With MAX_REPOS=5: ~5-10 seconds
- Step 6: ~30 seconds (combine and export to CSV)
  - With MAX_REPOS=5: ~5 seconds

Total for full run (~100 repos): ~25-35 minutes
Total with MAX_REPOS=5: ~2-3 minutes

Rate limit usage: ~700-900 requests total for full run (well within 5,000/hour limit)

**Resumability**: If a step fails or is interrupted, re-running it will skip already-processed repos and continue from where it stopped.