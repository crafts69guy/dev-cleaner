export type ProviderId =
  | "codex"
  | "claude"
  | "node"
  | "npm"
  | "pnpm"
  | "bun"
  | "uv"
  | "rustup"
  | "cargo"
  | "gradle"
  | "android"
  | "homebrew"
  | "xcode"
  | "docker"
  | "projects";

export type CleanupPolicy = "trash" | "command";
export type RiskLevel = "safe" | "review" | "high";

export interface CommandSpec {
  executable: string;
  args: string[];
  timeoutMs?: number;
}

export interface CleanupCandidate {
  id: string;
  providerId: ProviderId;
  section: string;
  title: string;
  subtitle: string;
  description: string;
  cleanupPolicy: CleanupPolicy;
  risk: RiskLevel;
  selectedByDefault: boolean;
  bytes?: number;
  modifiedAt?: Date;
  path?: string;
  command?: CommandSpec;
}

export interface ScanIssue {
  providerId: ProviderId;
  message: string;
}

export interface ScanResult {
  candidates: CleanupCandidate[];
  issues: ScanIssue[];
}

export interface ScanContext {
  homeDirectory: string;
  projectRoots: string[];
  extraPath?: string;
  now?: Date;
  signal?: AbortSignal;
}

export interface CleanupProvider {
  id: ProviderId;
  scan(context: ScanContext): Promise<ScanResult>;
}

export interface CleanupResult {
  candidateId: string;
  status: "cleaned" | "failed";
  bytes?: number;
  message?: string;
}

export interface CleanupHistoryItem extends CleanupResult {
  title: string;
  providerId: ProviderId;
  cleanupPolicy: CleanupPolicy;
}

export interface CleanupRun {
  id: string;
  startedAt: string;
  completedAt: string;
  items: CleanupHistoryItem[];
}
