// Synthetic public configuration only. Never read .env files or contact a real project.
for (const key of ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL', 'DEEPSEEK_API_KEY'])
  delete process.env[key]
Object.assign(process.env, {
  DEPLOY_BASE_PATH: '/CC/',
  VITE_STATIC_HOST: 'true',
  VITE_EXPERIMENT_SYNC: 'true',
  VITE_SUPABASE_URL: 'https://signallab-test.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_signallab_test_fixture',
})
const { build, preview } = await import('vite')
await build({ envDir: false, build: { outDir: 'dist-cloud' } })
await preview({
  build: { outDir: 'dist-cloud' },
  preview: { host: '127.0.0.1', port: 4177, strictPort: true },
})
