#!/usr/bin/env node

/**
 * Test script for Synapse MCP integration
 * This script verifies that the MCP server can connect and respond to basic tool calls
 */

import { spawn } from 'child_process';
import readline from 'readline';

async function testMCPServer() {
    console.log('🧪 Testing Synapse MCP Server Integration');

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
                name: 'synapse-test-client',
                version: '1.0.0'
            }
        }
    };

    mcpServer.stdin.write(JSON.stringify(initMessage) + '\n');

    // Test 2: List available tools
    setTimeout(() => {
        console.log('\n🔧 Test 2: List available tools');
        const listToolsMessage = {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list'
        };
        mcpServer.stdin.write(JSON.stringify(listToolsMessage) + '\n');
    }, 1000);

    // Test 3: List available resources
    setTimeout(() => {
        console.log('\n📚 Test 3: List available resources');
        const listResourcesMessage = {
            jsonrpc: '2.0',
            id: 3,
            method: 'resources/list'
        };
        mcpServer.stdin.write(JSON.stringify(listResourcesMessage) + '\n');
    }, 2000);

    // Test 4: Test new conversation summary tool
    setTimeout(() => {
        console.log('\n💬 Test 4: Test conversation summary tool');
        const conversationSummaryMessage = {
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: {
                name: 'synapse_get_conversation_summary',
                arguments: {
                    topic: 'machine learning',
                    limit: 5
                }
            }
        };
        mcpServer.stdin.write(JSON.stringify(conversationSummaryMessage) + '\n');
    }, 3000);

    // Test 5: Test learning goals with syllabus integration
    setTimeout(() => {
        console.log('\n🎯 Test 5: Test learning goals with syllabus integration');
        const learningGoalsMessage = {
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: {
                name: 'synapse_get_learning_goals',
                arguments: {
                    topic: 'machine learning'
                }
            }
        };
        mcpServer.stdin.write(JSON.stringify(learningGoalsMessage) + '\n');
    }, 4000);

    // Test 6: Test assignments tracker
    setTimeout(() => {
        console.log('\n📋 Test 6: Test assignments tracker');
        const assignmentsMessage = {
            jsonrpc: '2.0',
            id: 6,
            method: 'tools/call',
            params: {
                name: 'synapse_get_assignments',
                arguments: {
                    status: 'pending'
                }
            }
        };
        mcpServer.stdin.write(JSON.stringify(assignmentsMessage) + '\n');
    }, 5000);

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

testMCPServer().catch(console.error);