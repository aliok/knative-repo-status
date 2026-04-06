# Knative Repository Health Analyzer - Implementation Plan

## Context

The Knative project maintains repositories across two GitHub organizations (`knative` and `knative-extensions`). There's a concern that some repositories may be obsolete and should be deprecated - they're being maintained but not actively used by the community.

This tool will analyze comprehensive health metrics across all repositories to identify potentially obsolete ones, helping maintainers make data-driven decisions about which repositories to continue investing in versus deprecating.

## Approach

Build a TypeScript/Node.js CLI application using Octokit (GitHub's official API client) that:
1. Fetches all repositories from both organizations
2. Collects comprehensive health metrics (activity, usage, dependencies)
3. Calculates multi-dimensional health scores
4. Identifies potentially obsolete repositories
5. Generates reports in multiple formats (console, JSON, CSV, HTML)

The design uses a modular architecture with collectors (data fetching), analyzers (health scoring), and reporters (output generation), with built-in caching and rate limit handling for efficient GitHub API usage.

## Project Structure

```
knative-repo-status/
├── src/
│   ├── index.ts                      # Main orchestrator
│   ├── config/
│   │   ├── constants.ts              # Thresholds, API endpoints
│   │   └── github.ts                 # Octokit client with plugins
│   ├── types/
│   │   ├── repository.ts             # Repository data models
│   │   ├── metrics.ts                # Health metrics interfaces
│   │   └── report.ts                 # Report types
│   ├── collectors/
│   │   ├── base-collector.ts         # Abstract base with caching
│   │   ├── repository-collector.ts   # Fetch repos from orgs
│   │   ├── activity-collector.ts     # Commits, issues, PRs
│   │   ├── usage-collector.ts        # Stars, forks, traffic
│   │   └── dependency-collector.ts   # Cross-repo dependencies
│   ├── analyzers/
│   │   ├── health-scorer.ts          # Calculate health scores
│   │   └── obsolescence-detector.ts  # Identify obsolete repos
│   ├── reporters/
│   │   ├── console-reporter.ts       # Colored terminal output
│   │   ├── json-reporter.ts          # JSON export
│   │   ├── csv-reporter.ts           # CSV for spreadsheets
│   │   └── html-reporter.ts          # Interactive dashboard
│   └── utils/
│       ├── cache.ts                  # File-based caching
│       ├── rate-limiter.ts           # Rate limit handling
│       └── logger.ts                 # Structured logging
├── package.json
├── tsconfig.json
└── .env.example
```

## Core Data Models

### Repository Metrics (`src/types/metrics.ts`)

```typescript
interface RepositoryMetrics {
  repository: Repository;
  activityMetrics: ActivityMetrics;
  usageMetrics: UsageMetrics;
  dependencyMetrics: DependencyMetrics;
  healthScore: HealthScore;
  lastAnalyzed: Date;
}

interface ActivityMetrics {
  lastCommit: { date: Date; author: string; sha: string } | null;
  commits: {
    last30Days: number;
    last90Days: number;
    last180Days: number;
    last365Days: number;
  };
  issues: {
    open: number;
    closed: number;
    recentlyOpened30Days: number;
    recentlyClosed30Days: number;
    avgTimeToClose: number;
  };
  pullRequests: {
    open: number;
    merged: number;
    recentlyMerged30Days: number;
    avgTimeToMerge: number;
  };
  contributors: {
    total: number;
    active30Days: number;
    active90Days: number;
  };
  releases: {
    latestRelease: { name: string; publishedAt: Date } | null;
    daysSinceLastRelease: number | null;
  };
}

interface UsageMetrics {
  stars: number;
  forks: number;
  watchers: number;
  traffic: {
    views: { count: number; uniques: number } | null;
    clones: { count: number; uniques: number } | null;
  } | null; // Requires push access
}

interface DependencyMetrics {
  dependents: string[];      // Repos that depend on this one
  dependencies: string[];    // Repos this depends on
  crossReferences: {
    mentionedIn: string[];   // Repos mentioning this in issues/PRs
  };
}

interface HealthScore {
  overall: number;           // 0-100
  breakdown: {
    activity: number;        // 0-100
    usage: number;          // 0-100
    maintenance: number;    // 0-100
    community: number;      // 0-100
  };
  status: 'healthy' | 'moderate' | 'at-risk' | 'obsolete';
  flags: string[];          // Warning messages
}
```

## Health Score Calculation

### Weighted Components (src/analyzers/health-scorer.ts)

**Activity Score (30% weight):**
- Last commit within 30 days: 30 pts
- Last commit 31-90 days: 20 pts
- Last commit 91-180 days: 10 pts
- Last commit 181-365 days: 5 pts
- Older than 365 days: 0 pts
- Bonus: +10 for >5 commits in last 30 days
- Bonus: +10 for >3 active contributors in last 90 days

**Usage Score (25% weight):**
- Stars: log10(stars + 1) × 10 (max 30 pts)
- Forks: log10(forks + 1) × 10 (max 20 pts)
- Recent issues/PRs: +10 for activity in last 30 days

**Maintenance Score (30% weight):**
- Release within 90 days: 30 pts
- Release within 180 days: 20 pts
- Release within 365 days: 10 pts
- PR avg merge time <7 days: +20 pts
- Issue avg close time <14 days: +10 pts

**Community Score (15% weight):**
- Active contributors (>5): +20 pts
- Growing contributor base: +10 pts
- Healthy issue close rate (>50%): +10 pts

### Obsolescence Detection Criteria

A repository is flagged as **potentially obsolete** if ANY of:
- Overall health score < 20
- Last commit > 180 days ago AND zero activity in last 90 days
- Archived status = true
- No releases in 365+ days AND no commits in 180+ days
- Zero stars AND zero forks AND no recent activity

**Status Classification:**
- Healthy: 70-100
- Moderate: 40-69
- At-Risk: 20-39
- Obsolete: <20

## API Integration Strategy

### Octokit Configuration (`src/config/github.ts`)

```typescript
import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';

const MyOctokit = Octokit.plugin(throttling, retry);

export function createOctokit(token: string): Octokit {
  return new MyOctokit({
    auth: token,
    throttle: {
      onRateLimit: (retryAfter, options) => true,  // Auto-retry
      onSecondaryRateLimit: (retryAfter, options) => true,
    },
    retry: {
      doNotRetry: [400, 401, 403, 404, 422],
    },
  });
}
```

### Collector Pattern (`src/collectors/base-collector.ts`)

All collectors extend a base class providing:
- Caching with configurable TTL
- Error handling and logging
- Rate limit awareness

```typescript
abstract class BaseCollector {
  constructor(
    protected octokit: Octokit,
    protected cache: Cache,
    protected logger: Logger
  ) {}

  protected async fetchWithCache<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 3600
  ): Promise<T> {
    const cached = await this.cache.get<T>(key);
    if (cached) return cached;

    const data = await fetcher();
    await this.cache.set(key, data, ttl);
    return data;
  }

  abstract collect(repo: Repository): Promise<any>;
}
```

### Caching Strategy (`src/utils/cache.ts`)

File-based JSON cache with TTL:
- Repository list: 1 hour
- Activity metrics: 30 minutes
- Usage metrics: 1 hour
- Dependency analysis: 12 hours
- Traffic data: 24 hours

Cache key format: `repos:${org}`, `repo:${fullName}:${metricType}`

## Output Formats

### Console Reporter
Colored terminal output with summary tables:
```
Knative Repository Health Analysis
Generated: 2026-04-06 10:30:00

Summary:
  Total: 87 | Healthy: 45 (52%) | At-Risk: 10 (11%) | Obsolete: 4 (5%)

Potentially Obsolete Repositories:
┌─────────────────────┬───────┬──────────┬──────────────┬──────────────┐
│ Repository          │ Score │ Status   │ Last Commit  │ Last Release │
├─────────────────────┼───────┼──────────┼──────────────┼──────────────┤
│ knative/old-project │   15  │ Obsolete │ 456 days ago │ Never        │
└─────────────────────┴───────┴──────────┴──────────────┴──────────────┘
```

### JSON Reporter
Full metrics export for programmatic use

### CSV Reporter
Spreadsheet-friendly format for analysis in Excel/Google Sheets

### HTML Reporter
Interactive dashboard with sortable tables and charts

## CLI Interface

```bash
# Basic usage
npx knative-repo-status

# Specific organizations
npx knative-repo-status --org knative --org knative-extensions

# Multiple output formats
npx knative-repo-status --format json,csv,html

# Filter by status
npx knative-repo-status --filter obsolete,at-risk

# Skip cache for fresh data
npx knative-repo-status --no-cache

# Verbose logging
npx knative-repo-status --verbose
```

## Dependencies

**Core:**
- `@octokit/rest` - GitHub API client
- `@octokit/plugin-throttling` - Rate limit handling
- `@octokit/plugin-retry` - Automatic retries
- `commander` - CLI argument parsing
- `chalk` - Colored console output
- `cli-table3` - Terminal tables
- `dotenv` - Environment variables
- `winston` - Structured logging

**Dev:**
- `typescript`, `@types/node`
- `jest`, `ts-jest` - Testing
- `eslint`, `prettier` - Code quality

## Critical Files to Implement

1. **src/types/metrics.ts** - Core data models; all modules depend on these interfaces
2. **src/config/github.ts** - Octokit initialization with plugins; required for all API calls
3. **src/collectors/base-collector.ts** - Base class with caching/error handling patterns
4. **src/analyzers/health-scorer.ts** - Health score calculation logic (core business logic)
5. **src/index.ts** - Main orchestrator coordinating collection, analysis, and reporting

## Implementation Sequence

**Phase 1: Foundation**
1. Initialize project (package.json, tsconfig.json)
2. Set up TypeScript configuration
3. Define core types and interfaces
4. Implement cache utility
5. Configure Octokit client with plugins

**Phase 2: Data Collection**
1. Implement base collector pattern
2. Repository collector (fetch org repos)
3. Activity collector (commits, issues, PRs, contributors)
4. Usage collector (stars, forks, traffic)
5. Dependency collector (cross-references)

**Phase 3: Analysis**
1. Health score calculator
2. Obsolescence detection logic
3. Flag generation for warnings

**Phase 4: Reporting**
1. Console reporter with colored tables
2. JSON reporter
3. CSV reporter
4. HTML reporter with dashboard

**Phase 5: Integration**
1. CLI argument parsing
2. Main orchestrator (coordinate all components)
3. Error handling and logging
4. End-to-end testing

## Error Handling

**Graceful Degradation:**
- Continue processing other repos if one fails
- Use cached data when API calls fail
- Log errors with context (repo, operation, timestamp)
- Mark partial results in reports

**Rate Limit Management:**
- Auto-retry with exponential backoff
- Monitor remaining quota
- Queue requests when limits approached
- Save partial results periodically

## Testing & Verification

**Unit Tests:**
- Mock Octokit responses
- Test health score calculations
- Verify obsolescence detection logic
- Test output formatting

**Integration Tests:**
- Test with real GitHub API (small test org)
- Verify caching behavior
- Test rate limit handling
- End-to-end workflow validation

**Verification Checklist:**
- [ ] Fetches all repos from both organizations
- [ ] Collects comprehensive metrics correctly
- [ ] Health scores calculated accurately
- [ ] Obsolete repos identified correctly
- [ ] All output formats work
- [ ] Cache reduces API calls significantly
- [ ] Rate limits respected
- [ ] Errors handled gracefully
- [ ] CLI arguments work as expected
- [ ] Reports contain accurate data

## Performance Expectations

- ~100 repositories: 5-10 minutes (first run, no cache)
- ~100 repositories: 1-2 minutes (with cache)
- Rate limit usage: ~300-500 requests per full analysis
- Process repositories in parallel (batches of 10)
- Cache enables frequent re-analysis without hitting limits

## Authentication

Required: GitHub personal access token with `repo` scope (for traffic data) or `public_repo` (for public data only)

Configuration via:
- `GITHUB_TOKEN` environment variable
- `.env` file
- `--token` CLI argument