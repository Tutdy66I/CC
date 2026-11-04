import { parentPort } from 'node:worker_threads'
globalThis.self=globalThis
self.postMessage=(value)=>parentPort.postMessage(value)
self.close=()=>parentPort.close()
await import('../../.test-build/src/research-v15/p1c.worker.js')
parentPort.on('message',value=>self.onmessage({data:value}))
