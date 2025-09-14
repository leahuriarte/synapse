import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

mermaid.initialize({ 
  startOnLoad: false, 
  theme: 'dark', 
  maxTextSize: 100000,
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis',
    rankDir: 'TD', // Top to bottom for better vertical spacing
    nodeSpacing: 80, // Increased horizontal spacing between nodes
    rankSpacing: 100, // Increased vertical spacing between ranks
    diagramPadding: 20 // Padding around the diagram
  },
  themeVariables: {
    primaryColor: '#6366f1',
    primaryTextColor: '#f8fafc',
    primaryBorderColor: '#4f46e5',
    lineColor: '#8b5cf6',
    secondaryColor: '#1a1a2e',
    tertiaryColor: '#16213e',
    background: 'transparent',
    mainBkg: '#1a1a2e',
    secondBkg: '#16213e',
    darkMode: true,
    // Consistent font sizing across all graphs
    primaryTextColor: '#f8fafc',
    fontSize: '12px',
    fontFamily: 'Inter, system-ui, sans-serif'
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

// Modal elements
const graphModal = document.getElementById('graph-modal');
const graphModalTitle = document.getElementById('graph-modal-title');
const graphModalClose = document.getElementById('graph-modal-close');
const graphModalGraph = document.getElementById('graph-modal-graph');

// Interactive graph elements
const interactiveGraph = document.getElementById('interactive-graph');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const resetViewBtn = document.getElementById('reset-view');

// Interactive state
let graphState = {
  scale: 1,
  translateX: 0,
  translateY: 0,
  isDragging: false,
  lastX: 0,
  lastY: 0
};

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

async function showGraph(loadingElement, graphElement, mermaidContent, showThumbnail = false, graphType = null) {
  if (mermaidContent && mermaidContent !== 'graph TD; X["booting…"]' && mermaidContent.trim() !== '') {
    fadeOut(loadingElement);
    
    // Clear previous content
    graphElement.innerHTML = '';
    
    try {
      // Generate unique ID for this render
      const graphId = `graph-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Use mermaid.render to convert text to SVG
      const { svg } = await mermaid.render(graphId, mermaidContent);
      
      if (showThumbnail) {
        // Create a thumbnail container with enhanced styling (only for personal graph)
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'graph-thumbnail';
        
        // Add a thumbnail wrapper for better control
        const thumbnailWrapper = document.createElement('div');
        thumbnailWrapper.className = 'thumbnail-wrapper';
        thumbnailWrapper.innerHTML = svg;
        
        // Scale and position the SVG for optimal thumbnail view
        const svgElement = thumbnailWrapper.querySelector('svg');
        if (svgElement) {
          // Get original dimensions
          const bbox = svgElement.getBBox();
          const originalWidth = bbox.width;
          const originalHeight = bbox.height;
          
          // Calculate consistent scale for thumbnail (consistent 12pt font equivalent)
          const containerWidth = 450; // Container width
          const containerHeight = 450; // Container height
          
          // Target a consistent scale that makes text approximately 12pt
          // This ensures all graphs have similar readability regardless of size
          const targetScale = 0.85; // Consistent scale for 12pt font equivalent
          
          // Calculate scale based on container, but prioritize consistency
          const scaleX = containerWidth / originalWidth;
          const scaleY = containerHeight / originalHeight;
          const fitScale = Math.min(scaleX, scaleY);
          
          // Use target scale, but don't exceed container bounds
          const optimalScale = Math.min(targetScale, fitScale);
          
          svgElement.style.transform = `scale(${optimalScale})`;
          svgElement.style.transformOrigin = 'center center';
          svgElement.style.maxWidth = 'none';
          svgElement.style.maxHeight = 'none';
          svgElement.style.width = 'auto';
          svgElement.style.height = 'auto';
          
          // Add subtle shadow and border for thumbnail effect
          svgElement.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))';
          svgElement.style.borderRadius = '4px';
        }
        
        thumbnailContainer.appendChild(thumbnailWrapper);
        
        // Add thumbnail overlay with info
        const thumbnailOverlay = document.createElement('div');
        thumbnailOverlay.className = 'thumbnail-overlay';
        thumbnailOverlay.innerHTML = `
          <div class="thumbnail-info">
            <span class="thumbnail-nodes">${countNodesInMermaid(mermaidContent)} nodes</span>
            <span class="thumbnail-action">Click to explore</span>
          </div>
        `;
        thumbnailContainer.appendChild(thumbnailOverlay);
        
        // Apply graph-specific colors to thumbnail
        applyGraphTypeColors(svgElement, graphType);
        
        graphElement.appendChild(thumbnailContainer);
      } else {
        // For non-thumbnail graphs, display the SVG directly
        const graphWrapper = document.createElement('div');
        graphWrapper.className = 'mermaid';
        graphWrapper.innerHTML = svg;
        
        // Apply graph-specific colors to direct SVG
        const svgElement = graphWrapper.querySelector('svg');
        applyGraphTypeColors(svgElement, graphType);
        
        graphElement.appendChild(graphWrapper);
      }
    } catch (error) {
      console.warn('Mermaid render error:', error);
      if (showThumbnail) {
        // Fallback to a styled placeholder thumbnail
        const fallbackContainer = document.createElement('div');
        fallbackContainer.className = 'graph-thumbnail fallback';
        fallbackContainer.innerHTML = `
          <div class="fallback-content">
            <div class="fallback-icon">📊</div>
            <div class="fallback-text">Graph Preview</div>
            <div class="fallback-subtext">${countNodesInMermaid(mermaidContent)} nodes</div>
          </div>
        `;
        graphElement.appendChild(fallbackContainer);
      } else {
        // Fallback for non-thumbnail graphs
        const fallbackWrapper = document.createElement('div');
        fallbackWrapper.className = 'mermaid';
        fallbackWrapper.innerHTML = `<pre style="color: var(--text-muted); font-size: 14px; white-space: pre-wrap;">${mermaidContent}</pre>`;
        graphElement.appendChild(fallbackWrapper);
      }
    }
    
    fadeIn(graphElement);
  } else {
    fadeOut(graphElement);
    fadeIn(loadingElement);
  }
}

// Helper function to apply graph-specific node colors
function applyGraphTypeColors(svgElement, graphType) {
  if (!svgElement || !graphType) return;
  
  const nodes = svgElement.querySelectorAll('g.node rect, g.node circle, g.node polygon');
  
  let nodeColor, borderColor;
  switch (graphType) {
    case 'domain':
      nodeColor = '#fef3c7'; // Light yellow
      borderColor = '#f59e0b'; // Yellow
      break;
    case 'syllabus':
      nodeColor = '#dbeafe'; // Light blue
      borderColor = '#3b82f6'; // Blue
      break;
    case 'personal':
      nodeColor = '#d1fae5'; // Light green (current personal graph color)
      borderColor = '#10b981'; // Green
      break;
    default:
      return; // No changes for unknown types
  }
  
  nodes.forEach(node => {
    node.style.fill = nodeColor;
    node.style.stroke = borderColor;
    node.style.strokeWidth = '2px';
  });
}

// Helper function to count nodes in mermaid text
function countNodesInMermaid(mermaidText) {
  const nodeMatches = mermaidText.match(/\w+\["[^"]+"\]/g) || [];
  return nodeMatches.length;
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
    await Promise.all([
      showGraph(dgLoading, dgGraph, mm.dg, false, 'domain'), // Domain graph - no thumbnail, yellow nodes
      showGraph(sgLoading, sgGraph, mm.sg, false, 'syllabus'), // Syllabus graph - no thumbnail, blue nodes
      showGraph(pgLoading, pgGraph, mm.pg, false, 'personal')  // Personal graph - no thumbnail, green nodes
    ]);
  }

  // Update recommendations
  updateRecommendations(data.recommendations);

  lastData = data;
}

// Modal functionality
function openGraphModal(title, mermaidContent, graphType = null) {
  graphModalTitle.textContent = title;
  graphModal.classList.add('active');
  
  // Render the graph in the modal
  if (mermaidContent) {
    renderModalGraph(mermaidContent, graphType);
  }
  
  // Prevent body scroll
  document.body.style.overflow = 'hidden';
}

function closeGraphModal() {
  graphModal.classList.remove('active');
  document.body.style.overflow = '';
  
  // Clear modal content
  const modalMermaid = interactiveGraph.querySelector('.mermaid');
  if (modalMermaid) {
    modalMermaid.innerHTML = '';
  }
  
  // Reset graph state
  resetGraphState();
}

async function renderModalGraph(mermaidContent, graphType = null) {
  const modalMermaid = interactiveGraph.querySelector('.mermaid');
  if (!modalMermaid) return;
  
  // Reset graph state
  resetGraphState();
  
  try {
    const graphId = `modal-graph-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const { svg } = await mermaid.render(graphId, mermaidContent);
    modalMermaid.innerHTML = svg;
    
    // Ensure SVG scales properly in modal with consistent font size
    const svgElement = modalMermaid.querySelector('svg');
    if (svgElement) {
      svgElement.style.width = 'auto';
      svgElement.style.height = 'auto';
      svgElement.style.maxWidth = 'none';
      svgElement.style.maxHeight = 'none';
      svgElement.style.fontSize = '12px'; // Consistent font size in modal
      
      // Get the actual SVG dimensions
      const bbox = svgElement.getBBox();
      if (bbox.width && bbox.height) {
        // Set viewBox to ensure complete graph is visible with padding
        const padding = 20;
        const viewBoxX = bbox.x - padding;
        const viewBoxY = bbox.y - padding;
        const viewBoxWidth = bbox.width + (padding * 2);
        const viewBoxHeight = bbox.height + (padding * 2);
        
        svgElement.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);
        svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      }
      
      // Ensure all text elements have consistent sizing
      const textElements = svgElement.querySelectorAll('text');
      textElements.forEach(text => {
        text.style.fontSize = '12px';
        text.style.fontFamily = 'Inter, sans-serif';
      });
      
      // Apply graph-specific colors to modal graph
      applyGraphTypeColors(svgElement, graphType);
    }
    
    // Setup interactive features after rendering
    setupInteractiveGraph();
  } catch (error) {
    console.warn('Modal mermaid render error:', error);
    modalMermaid.innerHTML = `<pre style="color: var(--text-muted); font-size: 14px; white-space: pre-wrap;">${mermaidContent}</pre>`;
  }
}

// Interactive graph functions
function updateGraphTransform() {
  const transform = `translate(${graphState.translateX}px, ${graphState.translateY}px) scale(${graphState.scale})`;
  interactiveGraph.style.transform = transform;
}

function resetGraphState() {
  graphState = {
    scale: 1,
    translateX: 0,
    translateY: 0,
    isDragging: false,
    lastX: 0,
    lastY: 0
  };
  updateGraphTransform();
}

function zoomGraph(factor) {
  const newScale = Math.max(0.1, Math.min(5, graphState.scale * factor));
  graphState.scale = newScale;
  updateGraphTransform();
}

function setupInteractiveGraph() {
  const svg = interactiveGraph.querySelector('svg');
  if (!svg) return;

  // Mouse wheel zoom
  interactiveGraph.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    zoomGraph(zoomFactor);
  });

  // Mouse drag to pan
  interactiveGraph.addEventListener('mousedown', (e) => {
    graphState.isDragging = true;
    graphState.lastX = e.clientX;
    graphState.lastY = e.clientY;
    interactiveGraph.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (graphState.isDragging) {
      const deltaX = e.clientX - graphState.lastX;
      const deltaY = e.clientY - graphState.lastY;
      
      graphState.translateX += deltaX;
      graphState.translateY += deltaY;
      graphState.lastX = e.clientX;
      graphState.lastY = e.clientY;
      
      updateGraphTransform();
    }
  });

  document.addEventListener('mouseup', () => {
    graphState.isDragging = false;
    interactiveGraph.style.cursor = 'grab';
  });

  // Touch support for mobile
  let lastTouchDistance = 0;
  
  interactiveGraph.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      graphState.isDragging = true;
      graphState.lastX = e.touches[0].clientX;
      graphState.lastY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      lastTouchDistance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) +
        Math.pow(touch2.clientY - touch1.clientY, 2)
      );
    }
  });

  interactiveGraph.addEventListener('touchmove', (e) => {
    e.preventDefault();
    
    if (e.touches.length === 1 && graphState.isDragging) {
      const deltaX = e.touches[0].clientX - graphState.lastX;
      const deltaY = e.touches[0].clientY - graphState.lastY;
      
      graphState.translateX += deltaX;
      graphState.translateY += deltaY;
      graphState.lastX = e.touches[0].clientX;
      graphState.lastY = e.touches[0].clientY;
      
      updateGraphTransform();
    } else if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDistance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) +
        Math.pow(touch2.clientY - touch1.clientY, 2)
      );
      
      if (lastTouchDistance > 0) {
        const zoomFactor = currentDistance / lastTouchDistance;
        zoomGraph(zoomFactor);
      }
      
      lastTouchDistance = currentDistance;
    }
  });

  interactiveGraph.addEventListener('touchend', () => {
    graphState.isDragging = false;
    lastTouchDistance = 0;
  });
}

// Event listeners
graphModalClose.addEventListener('click', closeGraphModal);

// Zoom control event listeners
zoomInBtn.addEventListener('click', () => zoomGraph(1.2));
zoomOutBtn.addEventListener('click', () => zoomGraph(0.8));
resetViewBtn.addEventListener('click', resetGraphState);

// Close modal on backdrop click
graphModal.addEventListener('click', (e) => {
  if (e.target === graphModal) {
    closeGraphModal();
  }
});

// Close modal on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && graphModal.classList.contains('active')) {
    closeGraphModal();
  }
});

// Add click handlers to graph cards
function addGraphClickHandlers() {
  const dgCard = document.querySelector('.graph-card:nth-child(1) .graph-content');
  const sgCard = document.querySelector('.graph-card:nth-child(2) .graph-content');
  const pgCard = document.querySelector('.graph-card:nth-child(3) .graph-content');
  
  if (dgCard) {
    dgCard.addEventListener('click', () => {
      if (lastData?.mermaid?.dg) {
        openGraphModal('Domain Graph', lastData.mermaid.dg, 'domain');
      }
    });
  }
  
  if (sgCard) {
    sgCard.addEventListener('click', () => {
      if (lastData?.mermaid?.sg) {
        openGraphModal('Syllabus Graph', lastData.mermaid.sg, 'syllabus');
      }
    });
  }
  
  if (pgCard) {
    pgCard.addEventListener('click', () => {
      if (lastData?.mermaid?.pg) {
        openGraphModal('Personal Graph', lastData.mermaid.pg, 'personal');
      }
    });
  }
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

// Add click handlers after DOM is ready
document.addEventListener('DOMContentLoaded', addGraphClickHandlers);
// Also add handlers immediately in case DOM is already loaded
addGraphClickHandlers();
