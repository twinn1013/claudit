// Stage 1 placeholder — real implementation arrives in Stage 11.
// Pre-compiles via tsup so the dist/ layout is valid from Stage 1 onward.

async function main(): Promise<void> {
  process.stdout.write(JSON.stringify({ continue: true }) + "\n");
}

main().catch(() => {
  process.stdout.write(JSON.stringify({ continue: true }) + "\n");
});
