import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

mermaid.initialize({ 
  startOnLoad: false, 
  theme: 'dark', 
  maxTextSize: 100000,
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true
  }
});

// State management
let isOnline = false;
let lastData = null;

// DOM elements
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const dgCount = document.getElementById('dg-count');
const sgCount = document.getElementById('sg-count');
const pgCount = document.getElementById('pg-count');
const overlapCount = document.getElementById('overlap-count');
const sgBadge = document.getElementById('sg-badge');

// Graph elements
const dgLoading = document.getElementById('dg-loading');
const dgGraph = document.getElementById('dg');
const sgLoading = document.getElementById('sg-loading');
const sgGraph = document.getElementById('sg');
const pgLoading = document.getElementById('pg-loading');
const pgGraph = document.getElementById('pg');

// Recommendations
const recsEmpty = document.getElementById('recs-empty');
const recsList = document.getElementById('recs');

// Animation utilities
function fadeIn(element, duration = 300) {
  element.style.opacity = '0';
  element.style.display = 'block';
  element.style.transition = `opacity ${duration}ms ease`;
  requestAnimationFrame(() => {
    element.style.opacity = '1';
  });
}

function fadeOut(element, duration = 300) {
  element.style.transition = `opacity ${duration}ms ease`;
  element.style.opacity = '0';
  setTimeout(() => {
    element.style.display = 'none';
  }, duration);
}

function updateStatus(online) {
  if (isOnline !== online) {
    isOnline = online;
    statusDot.className = `status-dot ${online ? 'online' : 'offline'}`;
    statusText.textContent = online ? 'Connected' : 'Disconnected';
    
    // Add pulse animation for status change
    statusDot.style.animation = 'none';
    requestAnimationFrame(() => {
      statusDot.style.animation = 'pulse 0.6s ease-in-out';
    });
  }
}

function updateStats(counts) {
  const c = counts || {};
  const ov = c.overlaps || { dg_sg: 0, sg_pg: 0, dg_pg: 0 };
  
  // Animate count changes
  animateCount(dgCount, c.dg_nodes ?? 0);
  animateCount(sgCount, c.sg_nodes ?? 0);
  animateCount(pgCount, c.pg_nodes ?? 0);
  animateCount(overlapCount, ov.dg_sg + ov.sg_pg + ov.dg_pg);
  
  // Update syllabus badge
  const assessed = c.assessed_sg ?? 0;
  sgBadge.textContent = `Assessed: ${assessed}`;
}

function animateCount(element, newValue) {
  const currentValue = parseInt(element.textContent) || 0;
  if (currentValue !== newValue) {
    element.style.transform = 'scale(1.1)';
    element.style.color = 'var(--primary)';
    element.textContent = newValue;
    
    setTimeout(() => {
      element.style.transform = 'scale(1)';
      element.style.color = '';
    }, 200);
  }
}

function showGraph(loadingElement, graphElement, mermaidContent) {
  if (mermaidContent && mermaidContent !== 'graph TD; X["booting…"]') {
    fadeOut(loadingElement);
    graphElement.textContent = mermaidContent;
    fadeIn(graphElement);
  } else {
    fadeOut(graphElement);
    fadeIn(loadingElement);
  }
}

function updateRecommendations(recommendations) {
  if (!recommendations || recommendations.length === 0) {
    fadeOut(recsList);
    fadeIn(recsEmpty);
    return;
  }

  fadeOut(recsEmpty);
  recsList.innerHTML = '';
  
  recommendations.forEach((rec, index) => {
    const li = document.createElement('li');
    li.className = 'recommendation-item';
    
    li.innerHTML = `
      <div class="recommendation-number">${index + 1}</div>
      <div class="recommendation-content">
        <div class="recommendation-title">
          ${rec.link ? `<a href="${rec.link}" target="_blank" rel="noopener">${rec.label}</a>` : rec.label}
        </div>
        <div class="recommendation-description">${rec.why}</div>
        <div class="recommendation-meta">
          ${rec.due_in_days !== null && rec.due_in_days !== undefined 
            ? `<span class="meta-badge due">Due in ${rec.due_in_days} day${rec.due_in_days === 1 ? '' : 's'}</span>` 
            : ''}
          ${rec.missing_prereqs && rec.missing_prereqs.length > 0
            ? `<span class="meta-badge">Missing: ${rec.missing_prereqs.slice(0, 2).join(', ')}${rec.missing_prereqs.length > 2 ? '...' : ''}</span>`
            : ''}
        </div>
      </div>
    `;
    
    recsList.appendChild(li);
  });
  
  fadeIn(recsList);
}

async function poll() {
  // Health check
  try {
    const health = await fetch('/health', { cache: 'no-store' }).then(r => r.json());
    updateStatus(health.ok);
  } catch {
    updateStatus(false);
  }

  // Fetch data
  let data;
  try {
    data = await fetch(`/graphs?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.json());
  } catch (e) {
    console.error('Graphs fetch failed:', e);
    return;
  }

  // Update stats
  updateStats(data.counts);

  // Update graphs
  const { mermaid: mm } = data || {};
  if (mm) {
    showGraph(dgLoading, dgGraph, mm.dg);
    showGraph(sgLoading, sgGraph, mm.sg);
    showGraph(pgLoading, pgGraph, mm.pg);
  }

  // Update recommendations
  updateRecommendations(data.recommendations);

  // Render Mermaid graphs
  if (mm && (mm.dg || mm.sg || mm.pg)) {
    try {
      await mermaid.run({
        nodes: ['#dg', '#sg', '#pg']
          .filter(id => document.querySelector(id)?.textContent?.trim())
          .map(id => ({ id, selector: id }))
      });
    } catch (e) {
      console.warn('Mermaid render issue:', e?.message || e);
    }
  }

  lastData = data;
}

// Add pulse animation keyframes
const style = document.createElement('style');
style.textContent = `
  @keyframes pulse {
    0% { transform: scale(1); }
    50% { transform: scale(1.2); }
    100% { transform: scale(1); }
  }
`;
document.head.appendChild(style);

// Initialize
poll();
setInterval(poll, 3000);
