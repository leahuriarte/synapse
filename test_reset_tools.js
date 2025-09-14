#!/usr/bin/env node

/**
 * Test script for Synapse MCP Reset Tools
 * This script verifies that the new session reset tools work correctly
 */

import { spawn } from 'child_process';
import readline from 'readline';

async function testResetTools() {
    console.log('🧪 Testing Synapse MCP Reset Tools');

    // Start the MCP server
    const mcpServer = spawn('node', ['./mcp/dist/index.js'], {
        cwd: '/Users/leahuriarte/synapse',
        stdio: ['pipe', 'pipe', 'pipe']
    });

    let serverReady = false;

    // Set up communication
    const rl = readline.createInterface({
        input: mcpServer.stdout,
        output: process.stdout,
        terminal: false
    });

    // Listen for server output
    mcpServer.stdout.on('data', (data) => {
        console.log('Server output:', data.toString());
    });

    mcpServer.stderr.on('data', (data) => {
        console.error('Server error:', data.toString());
    });

    // Test 1: Initialize connection
    console.log('\n📡 Test 1: Initialize connection');
    const initMessage = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {
                tools: {},
                resources: {}
            },
            clientInfo: {
                name: 'synapse-reset-test-client',
                version: '1.0.0'
            }
        }
    };

    mcpServer.stdin.write(JSON.stringify(initMessage) + '\n');

    // Test 2: List available tools (should include new reset tools)
    setTimeout(() => {
        console.log('\n🔧 Test 2: List available tools');
        const listToolsMessage = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list'
        };
        mcpServer.stdin.write(JSON.stringify(listToolsMessage) + '\n');
    }, 1000);

    // Test 3: Test reset session (without confirmation)
    setTimeout(() => {
        console.log('\n⚠️ Test 3: Test reset session (without confirmation)');
        const resetMessage = {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
                name: 'synapse_reset_session',
                arguments: {
                    confirm: false
                }
            }
        };
        mcpServer.stdin.write(JSON.stringify(resetMessage) + '\n');
    }, 2000);

    // Test 4: Test fresh session startup
    setTimeout(() => {
        console.log('\n🌟 Test 4: Test fresh session startup');
        const freshSessionMessage = {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
                name: 'synapse_start_fresh_session',
                arguments: {
                    topic: 'machine learning',
                    resetGraphs: true
                }
            }
        };
        mcpServer.stdin.write(JSON.stringify(freshSessionMessage) + '\n');
    }, 3000);

    // Clean up after tests
    setTimeout(() => {
        console.log('\n✅ Tests completed. Shutting down server...');
        mcpServer.kill('SIGTERM');
        process.exit(0);
    }, 8000);

    // Handle server exit
    mcpServer.on('close', (code) => {
        console.log(`\nMCP server exited with code ${code}`);
    });
}

testResetTools().catch(console.error);