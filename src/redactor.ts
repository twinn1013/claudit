/**
 * Secret redaction for command strings.
 *
 * Patterns cover the most common forms of secrets that appear in shell
 * commands: query-param tokens, Authorization headers, env-var assignments,
 * CLI flag values, npm authTokens, git credential URLs, AWS keys, and SSH
 * private-key path arguments.
 *
 * All patterns are applied in declared order — accumulatively on the same
 * input string. The list is immutable at runtime; callers that need to
 * extend it should merge with DEFAULT_REDACTOR_PATTERNS.
 */

export interface RedactorPattern {
  name: string;
  regex: RegExp;
  replacement: string;
}

export interface RedactorPatterns {
  readonly patterns: ReadonlyArray<RedactorPattern>;
}

/**
 * 8 default secret patterns.
 *
 * Pattern descriptions and positive/negative examples are documented inline.
 * All regexes use the `g` flag (and `i` where case-insensitive matching is
 * desired) so they replace all occurrences in a single `replace` call.
 */
export const DEFAULT_REDACTOR_PATTERNS: RedactorPatterns = {
  patterns: [
    {
      // Pattern 1: token/key/secret query-string parameters.
      // Positive:  curl "https://api.example.com?token=abc123&v=2"
      //            → curl "https://api.example.com?token=<redacted>&v=2"
      // Negative:  curl "https://api.example.com?v=3.2.1" — unchanged.
      name: "query-param-token",
      regex:
        /([?&](?:token|key|secret|api[_-]?key|access[_-]?token|auth[_-]?token)=)[^&\s]+/gi,
      replacement: "$1<redacted>",
    },
    {
      // Pattern 2: Authorization: Bearer <value> (secret-shaped, 8+ chars).
      // Positive:  Authorization: Bearer sk-abc...xyz  → Bearer <redacted>
      // Negative:  Authorization: Basic public  — not Bearer, unchanged.
      name: "auth-bearer",
      regex: /(Authorization:\s*Bearer\s+)[A-Za-z0-9._\-~+/]{8,}=*/g,
      replacement: "$1<redacted>",
    },
    {
      // Pattern 3: env-var assignments whose names end with a secret suffix.
      // Suffix list: TOKEN SECRET KEY PASSWORD PASSWD CREDENTIAL AUTH
      // Positive:  GITHUB_TOKEN=ghp_xxx brew install  → GITHUB_TOKEN=<redacted> brew install
      // Negative:  NODE_ENV=production  — suffix "ENV" not in list, unchanged.
      name: "env-var-secret",
      regex:
        /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH))=\S+/g,
      replacement: "$1=<redacted>",
    },
    {
      // Pattern 4: --password / --auth-token / --api-key / --secret flag values.
      // Positive:  cli --password mysecret        → cli --password <redacted>
      //            cli --password=mysecret        → cli --password=<redacted>
      // Negative:  cli --verbose                  — unchanged.
      name: "cli-flag-secret",
      regex:
        /(--(?:password|passwd|auth[_-]?token|api[_-]?key|secret)[=\s]+)(?:"[^"]*"|'[^']*'|\S+)/gi,
      replacement: "$1<redacted>",
    },
    {
      // Pattern 5: npm _authToken in .npmrc-style registry entries.
      // Positive:  //registry.npmjs.org/:_authToken=npm_xxxx  → …=<redacted>
      // Negative:  //registry.npmjs.org/package-name         — unchanged.
      name: "npm-auth-token",
      regex: /(\/\/[^/\s]+\/:_authToken=)\S+/gi,
      replacement: "$1<redacted>",
    },
    {
      // Pattern 6: Git credential URLs: https://user:pass@host/...
      // Positive:  git clone https://user:token123@github.com/repo.git
      //            → git clone https://<redacted>@github.com/repo.git
      // Negative:  git clone https://github.com/repo.git  — unchanged.
      name: "git-credential-url",
      regex: /(https?:\/\/)[^:/@\s]+:[^@\s]+@/g,
      replacement: "$1<redacted>@",
    },
    {
      // Pattern 7: AWS access key IDs — both assignment and bare forms.
      // Positive:  AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE  → redacted
      //            AKIA followed by 16 uppercase-alnum chars → redacted
      // Negative:  AWS_REGION=us-east-1  — unchanged.
      name: "aws-access-key",
      regex: /\bAKIA[0-9A-Z]{16}\b/g,
      replacement: "<redacted>",
    },
    {
      // Pattern 8: SSH private-key path arguments (-i flag).
      // Two sub-patterns handled by a single regex: *.pem files and *id_rsa* files.
      // Positive:  ssh -i /home/u/.ssh/id_rsa host   → ssh -i <redacted> host
      //            ssh -i key.pem host                → ssh -i <redacted> host
      // Negative:  ssh -v host                        — unchanged.
      name: "ssh-key-path",
      regex:
        /(\s-i\s+)(?:"[^"]*\.(?:pem|key)"|'[^']*\.(?:pem|key)'|\S+\.(?:pem|key)|"[^"]*id_rsa[^"]*"|'[^']*id_rsa[^']*'|\S*id_rsa\S*)/g,
      replacement: "$1<redacted>",
    },
  ],
} as const;

/**
 * Apply all patterns in `patterns.patterns` to `command` accumulatively.
 * Returns the redacted string. Does not mutate `command`.
 *
 * Idempotent: `redactCommand(redactCommand(x)) === redactCommand(x)` because
 * the replacement value `<redacted>` never matches the secret patterns.
 */
export function redactCommand(
  command: string,
  patterns: RedactorPatterns = DEFAULT_REDACTOR_PATTERNS,
): string {
  let result = command;
  for (const p of patterns.patterns) {
    // Reset lastIndex before each replace so stateful `g` regexes work
    // correctly when called multiple times on different strings.
    p.regex.lastIndex = 0;
    result = result.replace(p.regex, p.replacement);
  }
  return result;
}
