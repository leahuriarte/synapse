# Synapse Learning System - Quick Start

## 🚀 How to Use (New Simplified Workflow)

### One-Step Learning Setup
```bash
# Run this command and follow the prompts:
npm run learn
```

This will:
1. **Ask for your subject** - What do you want to learn?
2. **Start the server automatically** if needed
3. **Build the domain graph** with all knowledge on your subject
4. **Find matching Canvas courses** or use a fallback syllabus
5. **Set up knowledge tracking** for every conversation
6. **Give you the command to start chatting** with Claude

### Manual Setup (Advanced)
```bash
# 1. Start server manually
npm start

# 2. Start learning with existing hooks
claude -p "Help me learn machine learning"
```

## ✨ What Happens Automatically

When you use the new workflow:

1. **🎯 Subject Selection**: Interactive prompt asks what you want to learn
2. **🧠 Domain Graph**: Built automatically from your topic using LLM
3. **📚 Canvas Integration**: Searches your Canvas courses for matches
4. **📋 Syllabus Graph**: Uses matching course OR creates structured fallback
5. **🔗 Knowledge Alignment**: Connects all graphs to find learning paths
6. **💬 Real-time Tracking**: Every conversation updates your personal knowledge graph

## 📊 Monitor Your Progress

Open http://localhost:3001 to see:
- **Domain Graph**: All knowledge concepts for your subject
- **Syllabus Graph**: Course structure and materials
- **Personal Graph**: Your current understanding level
- **Learning Progress**: Real-time concept mastery tracking
- **Conversation Activity**: Chat history and detected concepts

## 🎯 Learning Tips

- **Ask Claude to explain concepts**: "Explain gradient descent to me"
- **Demonstrate understanding**: "Let me try to explain backpropagation..."
- **Ask for verification**: "Can you check if I understand this correctly?"
- **Request next steps**: "What should I learn next based on my progress?"

## 🛠️ Troubleshooting

- **Server won't start**: Check if port 3001 is available
- **Canvas integration fails**: Check Canvas API keys in `.env`
- **No concept tracking**: Restart with `npm run learn` to reinitialize
- **Graphs not updating**: Check browser console for WebSocket errors

## 📁 File Structure

```
.claude/
├── settings.json          # Claude Code hook configuration
└── hooks/
    └── synapse_init.py   # Learning session initialization
.synapse-topic            # Current learning subject (auto-created)
start_learning.js         # New interactive setup script
```

Ready to start learning? Just run:
```bash
npm run learn
```
