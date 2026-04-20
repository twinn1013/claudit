import { describe, expect, it } from "vitest";
import { DEFAULT_REDACTOR_PATTERNS, redactCommand } from "../../src/redactor.js";

// ---------------------------------------------------------------------------
// Pattern 1: token/key/secret query params
// ---------------------------------------------------------------------------
describe("Pattern 1 — query-param token/key/secret", () => {
  it("positive: redacts ?token= value", () => {
    const cmd = `curl "https://api.example.com?token=abc123&v=2"`;
    expect(redactCommand(cmd)).toContain("?token=<redacted>");
    expect(redactCommand(cmd)).not.toContain("abc123");
  });

  it("positive: redacts ?key= value", () => {
    const cmd = `curl "https://api.example.com?key=s3cr3t"`;
    expect(redactCommand(cmd)).toContain("?key=<redacted>");
  });

  it("positive: redacts ?secret= value", () => {
    const cmd = `curl "https://api.example.com?secret=mysecretvalue"`;
    expect(redactCommand(cmd)).toContain("?secret=<redacted>");
  });

  it("positive: redacts &access_token= value", () => {
    const cmd = `curl "https://api.example.com?user=foo&access_token=tok123"`;
    expect(redactCommand(cmd)).toContain("&access_token=<redacted>");
    expect(redactCommand(cmd)).not.toContain("tok123");
  });

  it("negative: ?v=3.2.1 is NOT redacted", () => {
    const cmd = `curl "https://api.example.com?v=3.2.1"`;
    expect(redactCommand(cmd)).toBe(cmd);
  });

  it("negative: ?format=json is NOT redacted", () => {
    const cmd = `curl "https://api.example.com?format=json"`;
    expect(redactCommand(cmd)).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// Pattern 2: Authorization: Bearer
// ---------------------------------------------------------------------------
describe("Pattern 2 — Authorization: Bearer", () => {
  it("positive: redacts long Bearer token", () => {
    const cmd = `curl -H "Authorization: Bearer sk-abc123def456ghi789jkl012" https://api.example.com`;
    const out = redactCommand(cmd);
    expect(out).toContain("Authorization: Bearer <redacted>");
    expect(out).not.toContain("sk-abc123");
  });

  it("positive: redacts JWT-shaped Bearer token", () => {
    const cmd = `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig`;
    const out = redactCommand(cmd);
    expect(out).toContain("Authorization: Bearer <redacted>");
  });

  it("negative: Authorization: Basic public is NOT redacted", () => {
    const cmd = `curl -H "Authorization: Basic public" https://example.com`;
    expect(redactCommand(cmd)).toBe(cmd);
  });

  it("negative: Authorization: Bearer short (< 8 chars) is NOT redacted", () => {
    // "short" is 5 chars — below the 8-char threshold
    const cmd = `curl -H "Authorization: Bearer short" https://example.com`;
    expect(redactCommand(cmd)).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// Pattern 3: secret-suffix env-var assignments
// ---------------------------------------------------------------------------
describe("Pattern 3 — env-var secret assignments", () => {
  it("positive: GITHUB_TOKEN=ghp_xxx is redacted", () => {
    const cmd = `GITHUB_TOKEN=ghp_abcdef123456 brew install foo`;
    const out = redactCommand(cmd);
    expect(out).toContain("GITHUB_TOKEN=<redacted>");
    expect(out).not.toContain("ghp_abcdef");
  });

  it("positive: MY_API_KEY=value is redacted", () => {
    const cmd = `MY_API_KEY=supersecret npm run build`;
    const out = redactCommand(cmd);
    expect(out).toContain("MY_API_KEY=<redacted>");
  });

  it("positive: DB_PASSWORD=pass is redacted", () => {
    const cmd = `DB_PASSWORD=hunter2 ./start.sh`;
    const out = redactCommand(cmd);
    expect(out).toContain("DB_PASSWORD=<redacted>");
  });

  it("negative: NODE_ENV=production is NOT redacted", () => {
    const cmd = `NODE_ENV=production npm start`;
    expect(redactCommand(cmd)).toBe(cmd);
  });

  it("negative: PATH=/usr/bin is NOT redacted", () => {
    const cmd = `PATH=/usr/bin:/bin ls`;
    expect(redactCommand(cmd)).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// Pattern 4: --password / --auth-token flag values
// ---------------------------------------------------------------------------
describe("Pattern 4 — CLI flag secret values", () => {
  it("positive: --password mysecret is redacted (space form)", () => {
    const cmd = `cli --password mysecret --verbose`;
    const out = redactCommand(cmd);
    expect(out).toContain("--password <redacted>");
    expect(out).not.toContain("mysecret");
  });

  it("positive: --password=mysecret is redacted (= form)", () => {
    const cmd = `cli --password=mysecret`;
    const out = redactCommand(cmd);
    expect(out).toContain("--password=<redacted>");
  });

  it("positive: --auth-token value is redacted", () => {
    const cmd = `tool --auth-token abc123def456`;
    const out = redactCommand(cmd);
    expect(out).toContain("--auth-token <redacted>");
  });

  it("negative: --verbose is NOT redacted", () => {
    const cmd = `cli --verbose --dry-run`;
    expect(redactCommand(cmd)).toBe(cmd);
  });

  it("negative: --port 8080 is NOT redacted", () => {
    const cmd = `server --port 8080`;
    expect(redactCommand(cmd)).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// Pattern 5: npm authToken
// ---------------------------------------------------------------------------
describe("Pattern 5 — npm _authToken", () => {
  it("positive: //registry.npmjs.org/:_authToken=npm_xxx is redacted", () => {
    const cmd = `echo "//registry.npmjs.org/:_authToken=npm_xxxx1234" >> ~/.npmrc`;
    const out = redactCommand(cmd);
    expect(out).toContain("//registry.npmjs.org/:_authToken=<redacted>");
    expect(out).not.toContain("npm_xxxx1234");
  });

  it("positive: private registry authToken is redacted", () => {
    const cmd = `//my.registry.example.com/:_authToken=mytoken123 npm publish`;
    const out = redactCommand(cmd);
    expect(out).toContain(":_authToken=<redacted>");
  });

  it("negative: //registry.npmjs.org/package-name is NOT redacted", () => {
    const cmd = `npm install //registry.npmjs.org/package-name`;
    expect(redactCommand(cmd)).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// Pattern 6: git credential URLs
// ---------------------------------------------------------------------------
describe("Pattern 6 — git credential URLs", () => {
  it("positive: https://user:token123@github.com/repo.git is redacted", () => {
    const cmd = `git clone https://user:token123@github.com/repo.git`;
    const out = redactCommand(cmd);
    expect(out).toContain("https://<redacted>@github.com/repo.git");
    expect(out).not.toContain("token123");
  });

  it("positive: http://admin:pass@gitlab.example.com is redacted", () => {
    const cmd = `git pull http://admin:secretpass@gitlab.example.com/org/repo`;
    const out = redactCommand(cmd);
    expect(out).toContain("http://<redacted>@");
    expect(out).not.toContain("secretpass");
  });

  it("negative: https://github.com/repo.git (no credentials) is NOT redacted", () => {
    const cmd = `git clone https://github.com/repo.git`;
    expect(redactCommand(cmd)).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// Pattern 7: AWS access key IDs
// ---------------------------------------------------------------------------
describe("Pattern 7 — AWS access key IDs", () => {
  it("positive: AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE is redacted (via env-var pattern + AWS bare)", () => {
    const cmd = `AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE aws s3 ls`;
    const out = redactCommand(cmd);
    // env-var pattern catches AWS_ACCESS_KEY_ID=... (Pattern 3)
    // aws-access-key pattern catches bare AKIA... (Pattern 7)
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("positive: bare AKIA key in command is redacted", () => {
    const cmd = `echo AKIAIOSFODNN7EXAMPLE`;
    const out = redactCommand(cmd);
    expect(out).toContain("<redacted>");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("negative: AWS_REGION=us-east-1 is NOT redacted", () => {
    const cmd = `AWS_REGION=us-east-1 aws s3 ls`;
    expect(redactCommand(cmd)).toBe(cmd);
  });

  it("negative: AWS_DEFAULT_OUTPUT=json is NOT redacted", () => {
    const cmd = `AWS_DEFAULT_OUTPUT=json aws sts get-caller-identity`;
    expect(redactCommand(cmd)).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// Pattern 8: SSH private-key paths (-i flag)
// ---------------------------------------------------------------------------
describe("Pattern 8 — SSH key path (-i flag)", () => {
  it("positive: ssh -i /home/user/.ssh/id_rsa host is redacted", () => {
    const cmd = `ssh -i /home/user/.ssh/id_rsa example.com`;
    const out = redactCommand(cmd);
    expect(out).toContain("-i <redacted>");
    expect(out).not.toContain("id_rsa");
  });

  it("positive: ssh -i key.pem host is redacted", () => {
    const cmd = `ssh -i key.pem ec2-user@1.2.3.4`;
    const out = redactCommand(cmd);
    expect(out).toContain("-i <redacted>");
    expect(out).not.toContain("key.pem");
  });

  it("positive: ssh -i /path/to/my_key.pem is redacted", () => {
    const cmd = `ssh -i /path/to/my_key.pem ubuntu@host`;
    const out = redactCommand(cmd);
    expect(out).toContain("-i <redacted>");
  });

  it("negative: ssh -v host is NOT redacted", () => {
    const cmd = `ssh -v example.com`;
    expect(redactCommand(cmd)).toBe(cmd);
  });

  it("negative: ssh -p 2222 host is NOT redacted", () => {
    const cmd = `ssh -p 2222 user@example.com`;
    expect(redactCommand(cmd)).toBe(cmd);
  });
});

// ---------------------------------------------------------------------------
// General / cross-pattern tests
// ---------------------------------------------------------------------------
describe("General redaction behaviour", () => {
  it("non-secret content (brew install ripgrep) is NOT redacted", () => {
    const cmd = `brew install ripgrep`;
    expect(redactCommand(cmd)).toBe(cmd);
  });

  it("empty string → empty string", () => {
    expect(redactCommand("")).toBe("");
  });

  it("round-trip idempotency: applying twice yields same result (Pattern 1)", () => {
    const cmd = `curl "https://api.example.com?token=abc123"`;
    const once = redactCommand(cmd);
    const twice = redactCommand(once);
    expect(twice).toBe(once);
  });

  it("round-trip idempotency: applying twice yields same result (Pattern 3)", () => {
    const cmd = `GITHUB_TOKEN=ghp_abcdef brew install foo`;
    const once = redactCommand(cmd);
    const twice = redactCommand(once);
    expect(twice).toBe(once);
  });

  it("round-trip idempotency: applying twice yields same result (Pattern 6)", () => {
    const cmd = `git clone https://user:token123@github.com/repo.git`;
    const once = redactCommand(cmd);
    const twice = redactCommand(once);
    expect(twice).toBe(once);
  });

  it("exports exactly 8 patterns", () => {
    expect(DEFAULT_REDACTOR_PATTERNS.patterns).toHaveLength(8);
  });

  it("multiple secrets in one command are all redacted", () => {
    const cmd = `GITHUB_TOKEN=ghp_xyz curl "https://api.example.com?token=abc123"`;
    const out = redactCommand(cmd);
    expect(out).not.toContain("ghp_xyz");
    expect(out).not.toContain("abc123");
    expect(out).toContain("GITHUB_TOKEN=<redacted>");
    expect(out).toContain("?token=<redacted>");
  });
});
