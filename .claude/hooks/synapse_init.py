#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# ///

"""
Synapse Auto-Initialization Hook for Claude Code
Automatically sets up domain/syllabus graphs and enables chat tracking.
Enhanced for seamless Claude Code integration with persistent sessions.
"""

import json
import sys
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
import re
import os

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

def get_session_state():
    """Get current session state from persistent storage."""
    session_file = Path.cwd() / '.claude' / 'synapse_session.json'
    if session_file.exists():
        try:
            with open(session_file, 'r') as f:
                return json.load(f)
        except:
            pass
    return {'initialized': False, 'subject': None, 'session_id': None}

def save_session_state(state):
    """Save session state to persistent storage."""
    session_file = Path.cwd() / '.claude' / 'synapse_session.json'
    session_file.parent.mkdir(exist_ok=True)
    with open(session_file, 'w') as f:
        json.dump(state, f, indent=2)

def ensure_synapse_server():
    """Ensure Synapse server is running, start if needed."""
    health = call_synapse_api('/health')
    if health and health.get('ok'):
        return True

    print(f"🚀 Starting Synapse server...", file=sys.stderr)
    import subprocess
    import time

    try:
        # Start server in background
        subprocess.Popen(['npm', 'start'], cwd=Path.cwd(),
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Wait for server to start
        for i in range(10):
            time.sleep(1)
            health = call_synapse_api('/health')
            if health and health.get('ok'):
                print(f"✅ Synapse server started", file=sys.stderr)
                return True

        print(f"❌ Failed to start Synapse server", file=sys.stderr)
        return False
    except Exception as e:
        print(f"❌ Error starting server: {e}", file=sys.stderr)
        return False

def initialize_synapse_session(prompt, subject):
    """Initialize complete Synapse session."""
    session_state = get_session_state()

    # Check if already initialized for this subject
    if session_state.get('initialized') and session_state.get('subject') == subject:
        print(f"🎓 Synapse already active for: {subject}", file=sys.stderr)
        return True

    print(f"\n🎓 Synapse Learning System Initializing...", file=sys.stderr)
    print(f"📖 Subject: {subject}", file=sys.stderr)
    print(f"📊 Monitor: http://localhost:3001", file=sys.stderr)

    # Ensure server is running
    if not ensure_synapse_server():
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

    # Save session state
    session_id = f"session_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    save_session_state({
        'initialized': True,
        'subject': subject,
        'session_id': session_id,
        'started_at': datetime.now().isoformat()
    })

    # Send initial tracking
    call_synapse_api('/hooks/chat', {
        'role': 'user',
        'text': prompt,
        'topicHint': subject,
        'workspace': Path.cwd().name,
        'session_id': session_id,
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
