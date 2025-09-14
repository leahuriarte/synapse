#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fetch from 'node-fetch';

interface SynapseConfig {
  serverUrl: string;
  workspace: string;
}

class SynapseMCPServer {
  private server: Server;
  private config: SynapseConfig;

  constructor() {
    this.config = {
      serverUrl: process.env.SYNAPSE_URL || 'http://localhost:3001',
      workspace: process.cwd().split('/').pop() || 'default'
    };

    this.server = new Server(
      {
        name: 'synapse-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupResourceHandlers();
  }

  private async callSynapseAPI(endpoint: string, data?: any, method: string = 'GET'): Promise<any> {
    try {
      const url = `${this.config.serverUrl}${endpoint}`;
      const options: any = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (data && method !== 'GET') {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Synapse API call failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'synapse_start_learning',
          description: 'Initialize learning session for a specific topic',
          inputSchema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'The subject or topic to learn about',
              },
            },
            required: ['topic'],
          },
        },
        {
          name: 'synapse_track_conversation',
          description: 'Track a conversation message for learning progress',
          inputSchema: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                enum: ['user', 'assistant'],
                description: 'Who sent the message',
              },
              content: {
                type: 'string',
                description: 'The message content',
              },
              topicHint: {
                type: 'string',
                description: 'Optional topic hint for better concept extraction',
              },
            },
            required: ['role', 'content'],
          },
        },
        {
          name: 'synapse_get_progress',
          description: 'Get current learning progress and recommendations',
          inputSchema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'Optional topic to filter progress for',
              },
            },
            required: [],
          },
        },
        {
          name: 'synapse_get_concepts',
          description: 'Get available concepts for a topic',
          inputSchema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'The topic to get concepts for',
              },
            },
            required: ['topic'],
          },
        },
        {
          name: 'synapse_align_knowledge',
          description: 'Run knowledge alignment between domain and personal graphs',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'synapse_get_conversation_summary',
          description: 'Get summary of learning conversations organized by topic',
          inputSchema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'Optional topic to filter conversations',
              },
              limit: {
                type: 'number',
                description: 'Limit number of conversations to summarize (default: 10)',
              },
            },
            required: [],
          },
        },
        {
          name: 'synapse_get_learning_goals',
          description: 'Get learning goals from syllabus and track progress against them',
          inputSchema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'Topic to get learning goals for',
              },
            },
            required: [],
          },
        },
        {
          name: 'synapse_get_assignments',
          description: 'Get assignments tracker with Canvas integration (sample data for now)',
          inputSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['all', 'pending', 'completed', 'overdue'],
                description: 'Filter assignments by status',
              },
            },
            required: [],
          },
        },
        {
          name: 'synapse_reset_session',
          description: 'Reset learning session and clear all graphs for fresh start',
          inputSchema: {
            type: 'object',
            properties: {
              confirm: {
                type: 'boolean',
                description: 'Confirm that you want to reset all learning data',
              },
            },
            required: ['confirm'],
          },
        },
        {
          name: 'synapse_start_fresh_session',
          description: 'Start a completely fresh learning session with topic (automatically resets graphs)',
          inputSchema: {
            type: 'object',
            properties: {
              topic: {
                type: 'string',
                description: 'The subject or topic to learn about',
              },
              resetGraphs: {
                type: 'boolean',
                description: 'Whether to clear existing graphs (default: true)',
              },
            },
            required: ['topic'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'synapse_start_learning':
            return await this.startLearning((args as any)?.topic);

          case 'synapse_track_conversation':
            return await this.trackConversation((args as any)?.role, (args as any)?.content, (args as any)?.topicHint);

          case 'synapse_get_progress':
            return await this.getProgress((args as any)?.topic);

          case 'synapse_get_concepts':
            return await this.getConcepts((args as any)?.topic);

          case 'synapse_align_knowledge':
            return await this.alignKnowledge();

          case 'synapse_get_conversation_summary':
            return await this.getConversationSummary((args as any)?.topic, (args as any)?.limit);

          case 'synapse_get_learning_goals':
            return await this.getLearningGoals((args as any)?.topic);

          case 'synapse_get_assignments':
            return await this.getAssignments((args as any)?.status);

          case 'synapse_reset_session':
            return await this.resetSession((args as any)?.confirm);

          case 'synapse_start_fresh_session':
            return await this.startFreshSession((args as any)?.topic, (args as any)?.resetGraphs);

          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'synapse://learning-dashboard',
          mimeType: 'application/json',
          name: 'Learning Dashboard',
          description: 'Current learning progress and statistics',
        },
        {
          uri: 'synapse://domain-graph',
          mimeType: 'application/json',
          name: 'Domain Knowledge Graph',
          description: 'Complete domain knowledge structure',
        },
        {
          uri: 'synapse://personal-graph',
          mimeType: 'application/json',
          name: 'Personal Learning Graph',
          description: 'Your current learning progress and understanding',
        },
        {
          uri: 'synapse://syllabus-graph',
          mimeType: 'application/json',
          name: 'Syllabus Structure',
          description: 'Course syllabus and learning objectives structure',
        },
        {
          uri: 'synapse://conversation-summary',
          mimeType: 'application/json',
          name: 'Conversation Summary',
          description: 'Summary of learning conversations by topic',
        },
        {
          uri: 'synapse://learning-goals',
          mimeType: 'application/json',
          name: 'Learning Goals',
          description: 'Learning objectives and progress tracking',
        },
        {
          uri: 'synapse://assignments-tracker',
          mimeType: 'application/json',
          name: 'Assignments Tracker',
          description: 'Canvas assignments and completion status',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      try {
        switch (uri) {
          case 'synapse://learning-dashboard':
            const dashboard = await this.callSynapseAPI('/api/dashboard');
            return {
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(dashboard, null, 2),
              }],
            };

          case 'synapse://domain-graph':
            const domainGraph = await this.callSynapseAPI('/api/graphs/domain');
            return {
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(domainGraph, null, 2),
              }],
            };

          case 'synapse://personal-graph':
            const personalGraph = await this.callSynapseAPI('/api/graphs/personal');
            return {
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(personalGraph, null, 2),
              }],
            };

          case 'synapse://syllabus-graph':
            const syllabusGraph = await this.callSynapseAPI('/api/graphs/syllabus');
            return {
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(syllabusGraph, null, 2),
              }],
            };

          case 'synapse://conversation-summary':
            const conversations = await this.callSynapseAPI('/api/conversations/summary');
            return {
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(conversations, null, 2),
              }],
            };

          case 'synapse://learning-goals':
            const goals = await this.callSynapseAPI('/api/learning-goals');
            return {
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(goals, null, 2),
              }],
            };

          case 'synapse://assignments-tracker':
            const assignments = await this.callSynapseAPI('/api/assignments');
            return {
              contents: [{
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(assignments, null, 2),
              }],
            };

          default:
            throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Resource read failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async startLearning(topic: string) {
    // Check server health first
    const health = await this.callSynapseAPI('/health');
    if (!health?.ok) {
      throw new McpError(ErrorCode.InternalError, 'Synapse server is not running');
    }

    // Build domain graph
    const domainResult = await this.callSynapseAPI('/graph/domain/build', { topic }, 'POST');

    if (!domainResult?.ok) {
      throw new McpError(ErrorCode.InternalError, 'Failed to build domain graph');
    }

    // Build syllabus graph (fallback)
    const syllabusResult = await this.callSynapseAPI('/ingest/fallback/syllabus/discrete', {}, 'POST');

    // Run alignment between domain and syllabus graphs
    await this.callSynapseAPI('/align/embedding', {}, 'POST');

    // Get syllabus structure for learning goals
    const syllabusGraph = await this.callSynapseAPI('/api/graphs/syllabus');
    const syllabusStats = syllabusGraph ? {
      totalConcepts: syllabusGraph.nodes?.length || 0,
      totalConnections: syllabusGraph.edges?.length || 0
    } : null;

    return {
      content: [{
        type: 'text',
        text: `✅ Learning session initialized for "${topic}"\n🧠 Domain graph built\n📚 Syllabus graph created${syllabusStats ? ` (${syllabusStats.totalConcepts} concepts, ${syllabusStats.totalConnections} connections)` : ''}\n🔗 Knowledge alignment completed\n\n📊 Monitor progress at: ${this.config.serverUrl}\n\n🎯 Learning features now available:\n• Conversation tracking\n• Learning goals from syllabus\n• Assignment integration\n• Progress alignment with course structure\n\nYou can now start learning! Ask questions about ${topic} and your progress will be tracked automatically against the course syllabus.`,
      }],
    };
  }

  private async trackConversation(role: string, content: string, topicHint?: string) {
    const data = {
      role,
      text: content,
      topicHint: topicHint || 'general',
      workspace: this.config.workspace,
      timestamp: new Date().toISOString(),
    };

    await this.callSynapseAPI('/hooks/chat', data, 'POST');

    return {
      content: [{
        type: 'text',
        text: `📝 Conversation tracked (${role}): ${content.slice(0, 100)}${content.length > 100 ? '...' : ''}`,
      }],
    };
  }

  private async getProgress(topic?: string) {
    const endpoint = topic ? `/api/progress?topic=${encodeURIComponent(topic)}` : '/api/progress';
    const progress = await this.callSynapseAPI(endpoint);

    return {
      content: [{
        type: 'text',
        text: `📊 Learning Progress${topic ? ` for ${topic}` : ''}:\n\n${JSON.stringify(progress, null, 2)}`,
      }],
    };
  }

  private async getConcepts(topic: string) {
    const concepts = await this.callSynapseAPI(`/api/concepts?topic=${encodeURIComponent(topic)}`);

    return {
      content: [{
        type: 'text',
        text: `🧠 Concepts for "${topic}":\n\n${JSON.stringify(concepts, null, 2)}`,
      }],
    };
  }

  private async alignKnowledge() {
    await this.callSynapseAPI('/align/embedding', {}, 'POST');

    return {
      content: [{
        type: 'text',
        text: '🔗 Knowledge alignment completed successfully!',
      }],
    };
  }

  private async getConversationSummary(topic?: string, limit?: number) {
    const endpoint = '/api/conversations/summary';
    const params = new URLSearchParams();
    if (topic) params.append('topic', topic);
    if (limit) params.append('limit', limit.toString());

    const fullEndpoint = params.toString() ? `${endpoint}?${params}` : endpoint;
    const summary = await this.callSynapseAPI(fullEndpoint);

    return {
      content: [{
        type: 'text',
        text: `💬 Conversation Summary${topic ? ` for "${topic}"` : ''}:\n\n${JSON.stringify(summary, null, 2)}`,
      }],
    };
  }

  private async getLearningGoals(topic?: string) {
    // Get syllabus graph for alignment
    const syllabusGraph = await this.callSynapseAPI('/api/graphs/syllabus');

    const endpoint = topic ? `/api/learning-goals?topic=${encodeURIComponent(topic)}` : '/api/learning-goals';
    const goals = await this.callSynapseAPI(endpoint);

    // Enhance with syllabus alignment
    const enhancedGoals = {
      ...goals,
      syllabusAlignment: syllabusGraph ? {
        totalConcepts: syllabusGraph.nodes?.length || 0,
        alignedConcepts: goals.alignedConcepts || 0,
        alignmentPercentage: syllabusGraph.nodes?.length ?
          Math.round(((goals.alignedConcepts || 0) / syllabusGraph.nodes.length) * 100) : 0
      } : null
    };

    return {
      content: [{
        type: 'text',
        text: `🎯 Learning Goals${topic ? ` for "${topic}"` : ''}:\n\n${JSON.stringify(enhancedGoals, null, 2)}`,
      }],
    };
  }

  private async getAssignments(status?: string) {
    // For now, use sample Canvas data since full integration isn't ready
    const sampleAssignments = {
      assignments: [
        {
          id: 'assignment_1',
          title: 'Machine Learning Fundamentals Quiz',
          course: 'CS 229 - Machine Learning',
          dueDate: '2024-09-20T23:59:00Z',
          status: 'pending',
          description: 'Quiz covering supervised learning basics',
          points: 50,
          submissionType: 'online_quiz',
          canvasUrl: 'https://canvas.example.edu/courses/123/assignments/456'
        },
        {
          id: 'assignment_2',
          title: 'Linear Regression Implementation',
          course: 'CS 229 - Machine Learning',
          dueDate: '2024-09-25T23:59:00Z',
          status: 'pending',
          description: 'Implement linear regression from scratch in Python',
          points: 100,
          submissionType: 'online_upload',
          canvasUrl: 'https://canvas.example.edu/courses/123/assignments/789'
        },
        {
          id: 'assignment_3',
          title: 'Neural Network Basics',
          course: 'CS 229 - Machine Learning',
          dueDate: '2024-09-15T23:59:00Z',
          status: 'completed',
          description: 'Understanding perceptrons and backpropagation',
          points: 75,
          grade: 72,
          submissionType: 'online_quiz',
          canvasUrl: 'https://canvas.example.edu/courses/123/assignments/321'
        }
      ],
      summary: {
        total: 3,
        pending: 2,
        completed: 1,
        overdue: 0,
        totalPoints: 225,
        earnedPoints: 72
      }
    };

    // Filter by status if provided
    let filteredAssignments = sampleAssignments;
    if (status && status !== 'all') {
      filteredAssignments = {
        ...sampleAssignments,
        assignments: sampleAssignments.assignments.filter(a => a.status === status)
      };
    }

    return {
      content: [{
        type: 'text',
        text: `📋 Assignments Tracker${status ? ` (${status})` : ''}:\n\n${JSON.stringify(filteredAssignments, null, 2)}`,
      }],
    };
  }

  private async resetSession(confirm?: boolean) {
    if (!confirm) {
      return {
        content: [{
          type: 'text',
          text: `⚠️ Session Reset Required Confirmation\n\nThis will permanently delete:\n• All learning graphs (domain, personal, syllabus)\n• All conversation history\n• All progress tracking\n• All concept alignments\n\nTo confirm, use: synapse_reset_session with confirm=true`,
        }],
      };
    }

    try {
      // Reset all graphs and data
      await this.callSynapseAPI('/api/reset', {}, 'POST');

      return {
        content: [{
          type: 'text',
          text: `🔄 Session Reset Complete!\n\n✅ All graphs cleared\n✅ Conversation history cleared\n✅ Progress data cleared\n✅ Ready for fresh learning session\n\nYou can now start a new topic with synapse_start_learning or synapse_start_fresh_session`,
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `❌ Reset failed: ${error instanceof Error ? error.message : String(error)}\n\nYou may need to restart the synapse server or check server logs.`,
        }],
      };
    }
  }

  private async startFreshSession(topic: string, resetGraphs: boolean = true) {
    if (!topic) {
      throw new McpError(ErrorCode.InvalidParams, 'Topic is required for fresh session');
    }

    try {
      let resetMessage = '';

      // Reset graphs if requested (default behavior)
      if (resetGraphs) {
        await this.callSynapseAPI('/api/reset', {}, 'POST');
        resetMessage = '🔄 Previous session data cleared\n';
      }

      // Check server health first
      const health = await this.callSynapseAPI('/health');
      if (!health?.ok) {
        throw new McpError(ErrorCode.InternalError, 'Synapse server is not running');
      }

      // Build fresh domain graph
      const domainResult = await this.callSynapseAPI('/graph/domain/build', { topic }, 'POST');

      if (!domainResult?.ok) {
        throw new McpError(ErrorCode.InternalError, 'Failed to build domain graph');
      }

      // Build fresh syllabus graph (fallback)
      const syllabusResult = await this.callSynapseAPI('/ingest/fallback/syllabus/discrete', {}, 'POST');

      // Run fresh alignment
      await this.callSynapseAPI('/align/embedding', {}, 'POST');

      // Get new syllabus structure for stats
      const syllabusGraph = await this.callSynapseAPI('/api/graphs/syllabus');
      const syllabusStats = syllabusGraph ? {
        totalConcepts: syllabusGraph.nodes?.length || 0,
        totalConnections: syllabusGraph.edges?.length || 0
      } : null;

      return {
        content: [{
          type: 'text',
          text: `🌟 Fresh Learning Session Started for "${topic}"\n\n${resetMessage}✅ New domain graph built\n📚 Fresh syllabus graph created${syllabusStats ? ` (${syllabusStats.totalConcepts} concepts, ${syllabusStats.totalConnections} connections)` : ''}\n🔗 Fresh knowledge alignment completed\n\n📊 Monitor progress at: ${this.config.serverUrl}\n\n🎯 Fresh session features:\n• Clean conversation tracking\n• New learning goals from syllabus\n• Fresh assignment integration\n• Zero previous progress interference\n\nStart learning! Your progress will be tracked from scratch.`,
        }],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Fresh session setup failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

const server = new SynapseMCPServer();
server.run().catch(console.error);