"""
Fixed Synapse Auto-Initialization Hook
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
        'discrete mathematics', 'discrete math', 'algorithms', 'data structures',
        'computer science', 'programming', 'python', 'javascript',
        'economics', 'microeconomics', 'macroeconomics',
        'organic chemistry', 'biochemistry', 'molecular biology'
    ]
    
    for subject in subjects:
        if subject in prompt_lower:
            return subject
    
    return None

def enable_learning_mode():
    """Enable aggressive concept detection mode."""
    try:
        call_synapse_api('/learning-mode/enable', {}, 'POST')
        print(f"🎓 Learning mode enabled - all concept mentions will be tracked", file=sys.stderr)
    except:
        pass  # Non-critical

def initialize_synapse_session(prompt, subject):
    """Initialize complete Synapse session."""
    print(f"\n🎓 Initializing Learning System for: {subject}", file=sys.stderr)
    
    # Check if server is running
    health = call_synapse_api('/health')
    if not health or not health.get('ok'):
        print(f"❌ Synapse server offline. Please run: npm start", file=sys.stderr)
        return False
    
    # Get current state to avoid rebuilding unnecessarily
    graphs = call_synapse_api('/graphs')
    counts = graphs.get('counts', {}) if graphs else {}
    
    needs_domain = counts.get('dg_nodes', 0) < 20
    needs_syllabus = counts.get('sg_nodes', 0) < 20
    
    print(f"📊 Current state: DG:{counts.get('dg_nodes',0)} SG:{counts.get('sg_nodes',0)} PG:{counts.get('pg_nodes',0)}", file=sys.stderr)
    
    # Build domain graph if needed
    if needs_domain:
        print(f"🧠 Building domain graph...", file=sys.stderr)
        result = call_synapse_api('/graph/domain/build', {'topic': subject}, 'POST')
        if not result or not result.get('ok'):
            print(f"⚠ Domain graph build failed, continuing anyway", file=sys.stderr)
        else:
            print(f"✓ Domain graph ready", file=sys.stderr)
    else:
        print(f"✓ Domain graph exists", file=sys.stderr)
    
    # Build syllabus if needed
    if needs_syllabus:
        print(f"📚 Creating structured syllabus...", file=sys.stderr)
        call_synapse_api('/ingest/fallback/syllabus/discrete', {}, 'POST')
        print(f"✓ Syllabus structure ready", file=sys.stderr)
    else:
        print(f"✓ Syllabus exists", file=sys.stderr)
    
    # Run alignments
    print(f"🔗 Computing knowledge connections...", file=sys.stderr)
    call_synapse_api('/align/embedding', {}, 'POST')
    
    # Enable learning mode for aggressive concept tracking
    enable_learning_mode()
    
    # Send initial session start
    call_synapse_api('/hooks/chat', {
        'role': 'system',
        'text': f'Learning session started for {subject}',
        'topicHint': subject,
        'workspace': Path.cwd().name,
        'timestamp': datetime.now().isoformat()
    }, 'POST')
    
    print(f"🚀 Ready! Monitor progress: http://localhost:3001", file=sys.stderr)
    return True

def track_conversation(role, text, topic_hint):
    """Track conversation turn in Synapse."""
    try:
        result = call_synapse_api('/hooks/chat', {
            'role': role,
            'text': text,
            'topicHint': topic_hint,
            'workspace': Path.cwd().name,
            'timestamp': datetime.now().isoformat()
        }, 'POST')
        
        if result and result.get('detected', 0) > 0:
            concepts = result.get('sample', [])
            concept_names = [c.get('label', '') for c in concepts]
            if concept_names:
                print(f"📚 Tracked concepts: {', '.join(concept_names[:3])}", file=sys.stderr)
        
        return result
    except Exception as e:
        print(f"Tracking failed: {e}", file=sys.stderr)
        return None

def main():
    try:
        stdin_data = sys.stdin.read()
        
        try:
            parsed_input = json.loads(stdin_data)
        except:
            parsed_input = {'raw_stdin': stdin_data}
        
        # Get or set topic context
        topic_file = Path.cwd() / '.synapse-topic'
        current_topic = None
        if topic_file.exists():
            try:
                current_topic = topic_file.read_text().strip()
            except:
                pass
        
        if not current_topic:
            current_topic = Path.cwd().name
        
        if 'prompt' in parsed_input:
            # UserPromptSubmit - handle initialization and tracking
            prompt = parsed_input.get('prompt', '').strip()
            subject = extract_subject_from_prompt(prompt)
            
            # If we found a subject and no topic file exists, save it
            if subject and not topic_file.exists():
                try:
                    topic_file.write_text(subject)
                    current_topic = subject
                except:
                    pass
            
            # Initialize on first learning prompt
            if subject:
                initialize_synapse_session(prompt, subject)
                
                # Create a clean prompt without implementation details
                enhanced_prompt = f"""{prompt}

[Your learning progress is being automatically tracked at http://localhost:3001]"""
                print(enhanced_prompt)
                
                # Track the user's message
                track_conversation('user', prompt, subject or current_topic)
                
            else:
                # Regular conversation tracking
                print(prompt)
                track_conversation('user', prompt, current_topic)
                
        else:
            # Handle other hook types (PostToolUse, etc.)
            if 'tool_output' in parsed_input:
                # Track Claude's responses
                tool_output = parsed_input.get('tool_output', {})
                if isinstance(tool_output, dict):
                    claude_text = (
                        tool_output.get('content', '') or 
                        tool_output.get('text', '') or 
                        str(tool_output) if tool_output else ''
                    )
                    if len(claude_text.strip()) > 20:
                        track_conversation('assistant', claude_text, current_topic)
            
            # Pass through original
            print(stdin_data)
    
    except Exception as e:
        # Always pass through input on error
        if 'stdin_data' in locals():
            print(stdin_data)
        else:
            print('')
        print(f"Synapse error: {e}", file=sys.stderr)
    
    sys.exit(0)

if __name__ == '__main__':
    main()