/**
 * Shared types used by every detector, the Scanner, and the hook I/O layer.
 *
 * The detector Collision schema is the contract consumed by Claude via
 * `additionalContext`; any field addition here is a visible protocol change.
 */

export type CollisionCategory =
  | "hook-matcher"
  | "slash-command"
  | "skill-name"
  | "subagent-type"
  | "mcp-identifier"
  | "path-binary"
  | "internal-error";

export type Severity = "critical" | "warning" | "info";

/**
 * - `definite`: exact string match collision or a confirmed mutual mutation.
 * - `possible`: detection fired but dynamic content (unresolved env vars,
 *   template literals, computed paths) prevents certainty.
 * - `unknown`: detector threw, timed out, or received unparseable input.
 */
export type Confidence = "definite" | "possible" | "unknown";

export interface FixSuggestion {
  command: string;
  scope: "global" | "project" | "shell" | "plugin";
  safety_level: "safe" | "destructive" | "manual-review";
  rationale: string;
}

export interface Collision {
  category: CollisionCategory;
  severity: Severity;
  confidence: Confidence;
  entities_involved: string[];
  suggested_fix: FixSuggestion[];
  message: string;
}

export interface ReportMetadata {
  timestamp: string;          // ISO 8601
  scan_duration_ms: number;
  detector_count: number;
  error_count: number;
}

export interface ReportData {
  collisions: Collision[];
  metadata: ReportMetadata;
}

/**
 * Hook stdin shape for PostToolUse, per Claude Code convention.
 * Additional fields may be present; we only read what we need.
 */
export interface PostToolUseStdin {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: {
    command?: string;
    [key: string]: unknown;
  };
  tool_output?: {
    stdout?: string;
    stderr?: string;
    exit_code?: number;
  };
  [key: string]: unknown;
}

/**
 * Hook stdout shape adopted from ecosystem convention. claudit wraps its
 * serialized Report inside `additionalContext` using `<claudit-report>`
 * XML tags so Claude can reliably extract the JSON payload.
 */
export interface HookOutput {
  continue: boolean;
  suppressOutput?: boolean;
  hookSpecificOutput?: {
    hookEventName: string;
    additionalContext: string;
  };
}

// ----- Snapshot data contract ---------------------------------------------

export interface HookScript {
  command: string;
  scriptPath?: string;
  scriptSource?: string;   // first 4KB of the resolved script source
  mutatesUpdatedInput?: "yes" | "no" | "unknown";
}

export interface HookRegistration {
  matcher?: string;
  hooks: HookScript[];
}

export interface PluginCommand {
  name: string;       // base name (e.g., "scan"), not namespaced
  path?: string;
}

export interface PluginSkill {
  name: string;
  triggerKeywords: string[];
}

export interface PluginAgent {
  type: string;
}

export interface McpServer {
  name: string;
  tools: string[];
  source: "plugin" | "settings";
}

export interface PluginSummary {
  name: string;
  pluginRoot: string;
  hookEvents: Record<string, HookRegistration[]>;
  commands: PluginCommand[];
  skills: PluginSkill[];
  agents: PluginAgent[];
  mcpServers: McpServer[];
}

export interface SnapshotData {
  globalRoot: string;
  projectRoot?: string;
  plugins: PluginSummary[];
  settingsMcpServers: McpServer[];
  pathBinaries: Record<string, string[]>;
  capturedAt: string;
  fingerprint: string;
}
