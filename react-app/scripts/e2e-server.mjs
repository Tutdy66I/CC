// Deliberately clear inherited provider configuration before importing production code.
for (const key of [
  'AI_API_KEY',
  'AI_BASE_URL',
  'AI_MODEL',
  'DEEPSEEK_API_KEY',
]) {
  delete process.env[key]
}
const { startProductionServer } =
  await import('../.server-build/server/productionServer.js')
startProductionServer(undefined, 4175)
