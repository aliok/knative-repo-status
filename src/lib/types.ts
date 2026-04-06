export interface Repository {
  name: string;
  fullName: string;
  organization: string;
  description: string | null;
  url: string;
  createdAt: string | null;
  updatedAt: string | null;
  pushedAt: string | null;
  isArchived: boolean;
  isFork: boolean;
  defaultBranch: string | null;
}

export interface BotsConfig {
  exactMatches: string[];
  substrings: string[];
}
