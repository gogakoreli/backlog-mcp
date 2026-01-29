#!/usr/bin/env npx tsx
/**
 * Integration test for bridge recovery after server restart.
 * Run: npx tsx scripts/test-bridge-recovery.ts
 */

import { spawn, execSync } from 'node:child_process';

const TEST_PORT = 3099;
const ENV = { ...process.env, BACKLOG_VIEWER_PORT: String(TEST_PORT) };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function serverUp(): Promise<boolean> {
  try {
    await fetch(`http://localhost:${TEST_PORT}/version`);
    return true;
  } catch {
    return false;
  }
}

function killPort(port: number) {
  try {
    // Only kill processes LISTENING on the port, not connected to it
    const output = execSync(`lsof -i :${port} -sTCP:LISTEN`, { encoding: 'utf-8' });
    const lines = output.trim().split('\n').slice(1); // skip header
    for (const line of lines) {
      const pid = line.split(/\s+/)[1];
      if (pid && pid !== String(process.pid)) {
        console.log(`   Killing PID ${pid}`);
        try { process.kill(Number(pid), 'SIGKILL'); } catch {}
      }
    }
  } catch {}
}

async function main() {
  console.log('=== Bridge Recovery Integration Test ===\n');
  
  // Cleanup
  console.log('0. Cleanup');
  killPort(TEST_PORT);
  await sleep(500);
  console.log('');

  // 1. Start server
  console.log('1. Starting server on port', TEST_PORT);
  const server = spawn('node', ['dist/cli/index.mjs', 'serve'], { env: ENV, stdio: 'pipe' });
  server.stdout?.on('data', d => console.log('   [server]', d.toString().trim()));
  server.stderr?.on('data', d => console.log('   [server err]', d.toString().trim()));
  
  for (let i = 0; i < 50; i++) {
    if (await serverUp()) break;
    await sleep(100);
  }
  console.log('   Server ready:', await serverUp());
  console.log('');

  // 2. Start bridge
  console.log('2. Starting bridge');
  const bridge = spawn('node', ['dist/cli/bridge.mjs'], { env: ENV, stdio: ['pipe', 'pipe', 'pipe'] });
  
  bridge.stdout?.on('data', d => console.log('   [bridge out]', d.toString().trim().slice(0, 100)));
  bridge.stderr?.on('data', d => console.log('   [bridge err]', d.toString().trim()));
  bridge.on('exit', code => console.log('   [bridge exit]', code));
  
  await sleep(3000);
  console.log('');

  // 3. First request
  console.log('3. Sending request to live server');
  bridge.stdin?.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  await sleep(1000);
  console.log('');

  // 4. Kill server
  console.log('4. Killing server');
  killPort(TEST_PORT);
  await sleep(1000);
  console.log('   Server up:', await serverUp());
  console.log('');

  // 5. Request to dead server
  console.log('5. Sending request to dead server');
  bridge.stdin?.write('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  await sleep(5000);
  console.log('');

  // 6. Check recovery
  console.log('6. Checking recovery');
  for (let i = 0; i < 30; i++) {
    const up = await serverUp();
    console.log(`   ${i}s: server up = ${up}`);
    if (up) break;
    await sleep(1000);
  }
  console.log('');

  // 7. Final request
  console.log('7. Sending request after recovery');
  bridge.stdin?.write('{"jsonrpc":"2.0","id":3,"method":"ping"}\n');
  await sleep(2000);
  console.log('');

  // Cleanup
  console.log('8. Cleanup');
  bridge.kill();
  killPort(TEST_PORT);
  
  console.log('\n=== TEST COMPLETE ===');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
