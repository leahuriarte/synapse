#!/bin/bash
# setup_synapse.sh - Complete setup script for Synapse + Claude Code integration

set -e

echo "🎓 Setting up Synapse Learning System..."

# Check if we're in the synapse directory
if [ ! -f "package.json" ] || ! grep -q "synapse" package.json; then
    echo "❌ Please run this script from the synapse project directory"
    exit 1
fi

# Create hooks directory in project root
echo "📁 Creating global hooks directory..."
mkdir -p .claude/hooks

# Create the initialization hook
echo "🔧 Creating Synapse initialization hook..."
cat > .claude/hooks/synapse_init.py << 'EOF'
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# ///

"""
Synapse Auto-Initialization Hook for Claude Code
Automatically sets up domain/syllabus graphs and enables chat tracking.
"""

import json
import sys
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
import re

def call_synapse_api(endpoint, data=None, method='GET'):
    """Call Synapse API with error handling."""
    try:
        url = f'http://localhost:3001{endpoint}'
        
        if data:
            req = urllib.request.Request(
                url,
                data=json.dumps(data).encode('utf-8'),
                headers={'Content-Type': 'application/json'}
            )
            req.get_method = lambda: method
        else:
            req = urllib.request.Request(url)
        
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"Synapse API call failed ({endpoint}): {e}", file=sys.stderr)
        return None

def extract_subject_from_prompt(prompt):
    """Extract learning subject from user's initial prompt."""
    prompt_lower = prompt.lower()
    
    # Look for patterns like "learn about X", "studying X", "help me with X"
    patterns = [
        r"learn(?:ing)?\s+(?:about\s+)?([a-zA-Z0-9\s\-_]+?)(?:\s+(?:step by step|basics|fundamentals|from scratch)|\.|$)",
        r"study(?:ing)?\s+([a-zA-Z0-9\s\-_]+?)(?:\s+(?:step by step|basics|fundamentals|from scratch)|\.|$)",
        r"help me (?:with|understand)\s+([a-zA-Z0-9\s\-_]+?)(?:\s+(?:step by step|basics|fundamentals|from scratch)|\.|$)",
        r"teach me\s+(?:about\s+)?([a-zA-Z0-9\s\-_]+?)(?:\s+(?:step by step|basics|fundamentals|from scratch)|\.|$)",
        r"explain\s+([a-zA-Z0-9\s\-_]+?)\s+(?:to me|concepts?|basics?|fundamentals?)",
        r"(?:what is|introduction to)\s+([a-zA-Z0-9\s\-_]+?)(?:\?|\.|$)",
    ]
    
    for pattern in patterns:
        match = re.search(pattern, prompt_lower)
        if match:
            subject = match.group(1).strip()
            # Clean up common noise words
            subject = re.sub(r'\b(?:the|a|an|some|basic|basics|fundamental|fundamentals)\b', '', subject)
            subject = ' '.join(subject.split())  # normalize whitespace
            if len(subject) > 2:  # meaningful subject
                return subject
    
    # Fallback: look for common academic subjects
    subjects = [
        'machine learning', 'deep learning', 'neural networks', 'artificial intelligence',
        'calculus', 'linear algebra', 'statistics', 'probability',
        'physics', 'chemistry', 'biology',
        'discrete mathematics', 'algorithms', 'data structures',
        'computer science', 'programming', 'python', 'javascript',
        'economics', 'microeconomics', 'macroeconomics',
        'organic chemistry', 'biochemistry', 'molecular biology'
    ]
    
    for subject in subjects:
        if subject in prompt_lower:
            return subject
    
    return None

def initialize_synapse_session(prompt, subject):
    """Initialize complete Synapse session."""
    print(f"\n🎓 Synapse Learning System Initializing...", file=sys.stderr)
    print(f"📖 Subject: {subject}", file=sys.stderr)
    print(f"📊 Monitor: http://localhost:3001", file=sys.stderr)
    
    # Check if server is running
    health = call_synapse_api('/health')
    if not health or not health.get('ok'):
        print(f"❌ Synapse server not running. Please start with: npm start", file=sys.stderr)
        return False
    
    # Build domain graph
    print(f"🧠 Building domain knowledge graph...", file=sys.stderr)
    result = call_synapse_api('/graph/domain/build', {'topic': subject}, 'POST')
    
    if not result or not result.get('ok'):
        print(f"✗ Domain graph building failed", file=sys.stderr)
        return False
    
    # Try syllabus graph
    print(f"📚 Building syllabus graph...", file=sys.stderr)
    call_synapse_api('/ingest/fallback/syllabus/discrete', {}, 'POST')
    
    # Run alignments
    print(f"🔗 Computing knowledge overlaps...", file=sys.stderr)
    call_synapse_api('/align/embedding', {}, 'POST')
    
    # Send initial tracking
    call_synapse_api('/hooks/chat', {
        'role': 'user',
        'text': prompt,
        'topicHint': subject,
        'workspace': Path.cwd().name,
        'timestamp': datetime.now().isoformat()
    }, 'POST')
    
    print(f"🚀 Synapse ready! Learning will be tracked automatically.", file=sys.stderr)
    return True

def main():
    try:
        stdin_data = sys.stdin.read()
        
        try:
            parsed_input = json.loads(stdin_data)
        except:
            parsed_input = {'raw_stdin': stdin_data}
        
        if 'prompt' in parsed_input:
            prompt = parsed_input.get('prompt', '').strip()
            subject = extract_subject_from_prompt(prompt)
            
            if subject:
                initialize_synapse_session(prompt, subject)
                enhanced_prompt = f"""{prompt}

[Synapse Learning System Active 🎓]
Your progress is being tracked at: http://localhost:3001
Learning topic: {subject}"""
                print(enhanced_prompt)
            else:
                # Track general conversation
                call_synapse_api('/hooks/chat', {
                    'role': 'user',
                    'text': prompt,
                    'topicHint': 'general',
                    'workspace': Path.cwd().name
                }, 'POST')
                print(prompt)
        else:
            # Handle other hook types
            if 'tool_output' in parsed_input:
                tool_output = parsed_input.get('tool_output', {})
                if isinstance(tool_output, dict):
                    claude_text = str(tool_output.get('content', '') or tool_output.get('text', '') or tool_output)
                    if len(claude_text.strip()) > 10:
                        call_synapse_api('/hooks/chat', {
                            'role': 'assistant',
                            'text': claude_text,
                            'workspace': Path.cwd().name
                        }, 'POST')
            print(stdin_data)
    
    except Exception as e:
        if 'stdin_data' in locals():
            print(stdin_data)
        else:
            print('')
        print(f"Synapse error: {e}", file=sys.stderr)
    
    sys.exit(0)

if __name__ == '__main__':
    main()
EOF

# Make it executable
chmod +x .claude/hooks/synapse_init.py

# Create Claude settings
echo "⚙️ Creating Claude settings..."
cat > .claude/settings.json << 'EOF'
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/synapse_init.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .claude/hooks/synapse_init.py"
          }
        ]
      }
    ]
  }
}
EOF

# Create a learning workspace creator script
echo "📝 Creating workspace setup script..."
cat > create_learning_workspace.py << 'EOF'
#!/usr/bin/env python3
"""Create a Synapse learning workspace"""

import os
import sys
import shutil
from pathlib import Path

def create_workspace(name, topic=None):
    """Create a learning workspace with Synapse integration."""
    workspace = Path(name)
    workspace.mkdir(exist_ok=True)
    
    # Copy hooks from parent
    synapse_root = Path.cwd()
    if (synapse_root / '.claude').exists():
        shutil.copytree(synapse_root / '.claude', workspace / '.claude', dirs_exist_ok=True)
    
    # Create topic file
    if topic:
        (workspace / '.synapse-topic').write_text(topic)
    
    # Create README
    readme = f"""# {name}

{f"Learning topic: **{topic}**" if topic else "Learning workspace"}

## Quick Start
1. `cd {name}`
2. `claude -p "Help me learn {topic or 'this topic'}"`

Your learning progress will be automatically tracked at: http://localhost:3001
"""
    (workspace / 'README.md').write_text(readme)
    
    print(f"✅ Created workspace: {workspace.absolute()}")
    print(f"🚀 Start learning: cd {name} && claude -p 'Help me learn {topic or 'this topic'}'")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 create_learning_workspace.py <workspace_name> [topic]")
        sys.exit(1)
    
    name = sys.argv[1]
    topic = sys.argv[2] if len(sys.argv) > 2 else None
    create_workspace(name, topic)
EOF

chmod +x create_learning_workspace.py

# Create a startup guide
echo "📋 Creating startup guide..."
cat > START_HERE.md << 'EOF'
# Synapse Learning System - Quick Start

## 🚀 How to Use

### Option 1: Direct from Synapse Directory (Simplest)
```bash
# 1. Start Synapse server
npm start

# 2. Start learning (Claude will auto-initialize everything)
claude -p "Help me learn machine learning"
```

### Option 2: Create Dedicated Learning Workspace
```bash
# 1. Start Synapse server  
npm start

# 2. Create workspace for specific topic
python3 create_learning_workspace.py ml-study "machine learning"

# 3. Start learning
cd ml-study
claude -p "Help me understand neural networks from scratch"
```

## ✨ What Happens Automatically

When you start a conversation with Claude:

1. **🧠 Domain Graph**: Built automatically from your topic
2. **📚 Syllabus Graph**: Created (fallback version for structure)  
3. **🔗 Alignment**: Knowledge graphs connected to find overlaps
4. **💬 Chat Tracking**: Every message tracked for learning progress
5. **📊 Personal Graph**: Updates as you demonstrate understanding

## 📊 Monitor Your Progress

Open http://localhost:3001 to see:
- Your knowledge graphs in real-time
- Learning progress visualization  
- Knowledge gaps and recommendations
- Conversation activity

## 🎯 Learning Tips

- **Ask Claude to explain concepts**: "Explain gradient descent to me"
- **Demonstrate understanding**: "Let me try to explain backpropagation..."
- **Ask for verification**: "Can you check if I understand this correctly?"
- **Request next steps**: "What should I learn next?"

## 🛠️ Troubleshooting

- **Server not running**: Make sure `npm start` is running in the synapse directory
- **No graphs showing**: Check the console for errors, may need to restart server
- **Not tracking learning**: Verify the .claude/hooks/synapse_init.py file exists and is executable

Ready to start learning? Try:
```bash
claude -p "I want to learn calculus from the fundamentals"
```
EOF

echo ""
echo "🎉 Synapse Learning System Setup Complete!"
echo ""
echo "📋 Quick Start:"
echo "   1. npm start                    # Start Synapse server"
echo "   2. claude -p 'Help me learn X'  # Start learning (auto-initializes)"
echo "   3. Open http://localhost:3001   # Monitor progress"
echo ""
echo "📖 Full instructions: cat START_HERE.md"
echo ""
echo "🚀 Ready to learn!"