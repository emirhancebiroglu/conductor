async function main(): Promise<void> {
  console.log("cm-worker booting");
}

main().catch((err) => {
  console.error("[cm-worker] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
