#!/usr/bin/env node

import 'dotenv/config';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

async function checkServerHealth() {
  try {
    const response = await fetch('http://localhost:3001/health');
    const health = await response.json();
    return health.ok;
  } catch {
    return false;
  }
}

async function getCourses() {
  try {
    const response = await fetch('http://localhost:3001/canvas/courses');
    const data = await response.json();
    return data.courses || [];
  } catch {
    return [];
  }
}

async function buildDomainGraph(subject) {
  try {
    const response = await fetch('http://localhost:3001/graph/domain/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: subject })
    });
    const result = await response.json();
    return result.ok;
  } catch {
    return false;
  }
}

async function ingestCanvasCourse(courseId) {
  try {
    const response = await fetch(`http://localhost:3001/ingest/canvas/${courseId}`, {
      method: 'POST'
    });
    const result = await response.json();
    return result.ok;
  } catch {
    return false;
  }
}

async function createFallbackSyllabus() {
  try {
    const response = await fetch('http://localhost:3001/ingest/fallback/syllabus/discrete', {
      method: 'POST'
    });
    const result = await response.json();
    return result.ok;
  } catch {
    return false;
  }
}

function startServer() {
  return new Promise((resolve) => {
    console.log('🚀 Starting Synapse server...');
    const serverProcess = spawn('npm', ['start'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true
    });

    let serverReady = false;
    const checkHealth = async () => {
      if (await checkServerHealth()) {
        serverReady = true;
        console.log('✅ Server is ready!');
        resolve(serverProcess);
      } else {
        setTimeout(checkHealth, 1000);
      }
    };

    // Start checking after a brief delay
    setTimeout(checkHealth, 2000);

    // Handle server output
    serverProcess.stdout.on('data', (data) => {
      if (!serverReady) {
        process.stdout.write(`[server] ${data}`);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      if (!serverReady) {
        process.stderr.write(`[server] ${data}`);
      }
    });
  });
}

async function setupLearningSession() {
  try {
    console.log('\n🎓 Welcome to Synapse Learning System!\n');

    // Check if server is already running
    let serverRunning = await checkServerHealth();

    if (!serverRunning) {
      // Run database migration first
      console.log('🔧 Initializing database...');
      try {
        const { spawn } = await import('child_process');
        const migrate = spawn('npm', ['run', 'db:migrate'], { stdio: 'inherit' });
        await new Promise((resolve, reject) => {
          migrate.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Migration failed with code ${code}`));
          });
        });
        console.log('✅ Database ready');
      } catch (e) {
        console.log('⚠️  Database migration failed, continuing anyway');
      }

      await startServer();
      serverRunning = await checkServerHealth();
    } else {
      console.log('✅ Server already running');
    }

    if (!serverRunning) {
      console.error('❌ Failed to start server. Please run `npm start` manually.');
      process.exit(1);
    }

    // Get subject from user
    const subject = await question('📚 What subject would you like to learn? ');
    if (!subject.trim()) {
      console.log('❌ Subject is required');
      process.exit(1);
    }

    console.log(`\n🎯 Setting up learning session for: ${subject}\n`);

    // Save subject for future use
    const topicFile = path.join(process.cwd(), '.synapse-topic');
    writeFileSync(topicFile, subject.trim());

    // Build domain graph
    console.log('🧠 Building domain knowledge graph...');
    const domainResult = await buildDomainGraph(subject);
    if (domainResult) {
      console.log('✅ Domain graph created');
    } else {
      console.log('⚠️  Domain graph creation failed (continuing anyway)');
    }

    // Try to find matching Canvas course
    console.log('🔍 Looking for matching Canvas courses...');
    const courses = await getCourses();

    let selectedCourseId = null;
    if (courses.length > 0) {
      // Find courses that might match the subject
      const matchingCourses = courses.filter(course =>
        course.name.toLowerCase().includes(subject.toLowerCase()) ||
        subject.toLowerCase().includes(course.name.toLowerCase())
      );

      if (matchingCourses.length > 0) {
        console.log('\n📚 Found potential matching courses:');
        matchingCourses.forEach((course, i) => {
          console.log(`${i + 1}. ${course.name} (${course.course_code || course.id})`);
        });
        console.log(`${matchingCourses.length + 1}. None of these match / Use fallback`);

        const selection = await question('\nSelect a course (number): ');
        const index = parseInt(selection) - 1;

        if (index >= 0 && index < matchingCourses.length) {
          selectedCourseId = matchingCourses[index].id;
          console.log(`✅ Selected: ${matchingCourses[index].name}`);
        }
      } else {
        console.log('📝 No matching courses found, will use fallback syllabus');
      }
    } else {
      console.log('📝 No Canvas courses available, will use fallback syllabus');
    }

    // Build syllabus graph
    if (selectedCourseId) {
      console.log('📚 Building course syllabus graph...');
      const syllabusResult = await ingestCanvasCourse(selectedCourseId);
      if (syllabusResult) {
        console.log('✅ Course syllabus ingested');
      } else {
        console.log('⚠️  Course ingestion failed, using fallback');
        await createFallbackSyllabus();
      }
    } else {
      console.log('📚 Creating structured syllabus...');
      await createFallbackSyllabus();
      console.log('✅ Fallback syllabus created');
    }

    // Run alignments
    console.log('🔗 Computing knowledge connections...');
    try {
      await fetch('http://localhost:3001/align/embedding', { method: 'POST' });
      console.log('✅ Knowledge alignment completed');
    } catch {
      console.log('⚠️  Alignment failed (continuing anyway)');
    }

    // Setup Claude Code hooks if not already configured
    const claudeDir = path.join(process.cwd(), '.claude');
    const hookFile = path.join(claudeDir, 'hooks', 'synapse_init.py');

    if (!existsSync(hookFile)) {
      console.log('⚠️  Claude Code hooks not found. Run setup_synapse.sh first.');
    } else {
      console.log('✅ Claude Code integration ready');
    }

    console.log(`\n🚀 Learning session ready! Open a new terminal and start chatting:`);
    console.log(`   cd ${process.cwd()}`);
    console.log(`   claude -p "Help me learn ${subject}"`);
    console.log(`\n📊 Monitor your progress: http://localhost:3001`);
    console.log(`\nThe server will continue running in the background.`);

  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n👋 Goodbye! Server continues running in background.');
  process.exit(0);
});

setupLearningSession();