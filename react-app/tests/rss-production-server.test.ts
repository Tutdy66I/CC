import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { resolveStaticFilePath } from '../server/productionServer.js'

const distDirectory = join(process.cwd(), 'dist')

test('resolves public asset paths under the distribution directory', () => {
  assert.equal(
    resolveStaticFilePath('/assets/site.js', distDirectory),
    join(distDirectory, 'assets', 'site.js'),
  )
})

test('rejects paths that escape the distribution directory', () => {
  assert.equal(
    resolveStaticFilePath('/../server/rssProxy.ts', distDirectory),
    null,
  )
})
