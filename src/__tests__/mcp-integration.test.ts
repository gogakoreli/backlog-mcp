import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';

describe('MCP Integration Tests', () => {
  let serverProcess: ChildProcess;
  const port = 3098;
  
  beforeAll(async () => {
    // Start server
    serverProcess = spawn('node', ['dist/server/fastify-server.js'], {
      env: { ...process.env, BACKLOG_VIEWER_PORT: port.toString() },
      stdio: 'pipe'
    });
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 2000));
  });
  
  afterAll(() => {
    serverProcess?.kill();
  });
  
  it('should handle StreamableHTTP requests', async () => {
    const response = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' }
        }
      })
    });
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('result');
    expect(data.result).toHaveProperty('serverInfo');
    expect(data.result.serverInfo.name).toBe('backlog-mcp');
  });
  
  it('should test stdio bridge mode', async () => {
    const bridge = spawn('node', ['dist/cli/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, BACKLOG_VIEWER_PORT: port.toString() }
    });
    
    const initMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' }
      }
    };
    
    bridge.stdin.write(JSON.stringify(initMessage) + '\n');
    
    const response = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);
      let buffer = '';
      
      bridge.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        
        for (const line of lines) {
          if (line.trim().startsWith('{')) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.result) {
                clearTimeout(timeout);
                resolve(parsed);
                return;
              }
            } catch (e) {
              // Not valid JSON, continue
            }
          }
        }
      });
    });
    
    expect(response).toHaveProperty('result');
    
    bridge.kill();
  });
});
