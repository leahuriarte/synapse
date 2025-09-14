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
    nodeSpacing: 30, // Reduced horizontal spacing between nodes
    rankSpacing: 80, // Reduced vertical spacing between ranks
    diagramPadding: 15, // Reduced padding around the diagram
    wrapping: 'wrap', // Enable text wrapping
    textDirection: 'tb', // Top to bottom text direction
    useGraphviz: false // Ensure we're using the default renderer
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
let masteryData = null;


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

// New sections elements - Learning gaps
const gapsHigh = document.getElementById('gaps-high');
const gapsMedium = document.getElementById('gaps-medium');
const gapsTotal = document.getElementById('gaps-total');
const goalsLoading = document.getElementById('goals-loading');
const goalsContent = document.getElementById('goals-content');
const goalsModules = document.getElementById('goals-modules');

const assignmentsPending = document.getElementById('assignments-pending');
const assignmentsOverdue = document.getElementById('assignments-overdue');
const assignmentsCompleted = document.getElementById('assignments-completed');
const assignmentsLoading = document.getElementById('assignments-loading');
const assignmentsContent = document.getElementById('assignments-content');
const assignmentsList = document.getElementById('assignments-list');

const conversationsLoading = document.getElementById('conversations-loading');
const conversationsContent = document.getElementById('conversations-content');
const conversationsSummary = document.getElementById('conversations-summary');

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
          
          // Calculate scale based on container, but prioritize readability
          const scaleX = containerWidth / originalWidth;
          const scaleY = containerHeight / originalHeight;
          const fitScale = Math.min(scaleX, scaleY);

          // Use 4x larger scale for better readability
          const targetScale = 3.5; // Increased for 4x zoom
          const optimalScale = Math.min(targetScale, fitScale * 4); // Allow up to 4x the fit scale
          
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
        
        // Apply text wrapping, graph-specific colors, and cross-graph mastery to thumbnail
        wrapSVGText(svgElement, 16);
        applyGraphTypeColors(svgElement, graphType);
        applyCrossGraphMastery(svgElement, graphType, masteryData);

        graphElement.appendChild(thumbnailContainer);
      } else {
        // For non-thumbnail graphs, display the SVG directly
        const graphWrapper = document.createElement('div');
        graphWrapper.className = 'mermaid';
        graphWrapper.innerHTML = svg;

        // Apply text wrapping, graph-specific colors, and cross-graph mastery to direct SVG
        const svgElement = graphWrapper.querySelector('svg');

        // Scale up the SVG for better readability - much larger scale for domain/syllabus graphs
        if (svgElement) {
          const scaleValue = (graphType === 'domain' || graphType === 'syllabus') ? 10 : 4;
          svgElement.style.transform = `scale(${scaleValue})`;
          svgElement.style.transformOrigin = 'center center';
          svgElement.style.maxWidth = 'none';
          svgElement.style.maxHeight = 'none';
          svgElement.style.width = 'auto';
          svgElement.style.height = 'auto';
        }

        // Make sure the wrapper can accommodate the scaled content
        graphWrapper.style.overflow = 'visible';
        graphWrapper.style.width = 'auto';
        graphWrapper.style.height = 'auto';
        graphWrapper.style.minHeight = '500px';
        graphWrapper.style.minWidth = '500px';

        wrapSVGText(svgElement, 16);
        applyGraphTypeColors(svgElement, graphType);
        applyCrossGraphMastery(svgElement, graphType, masteryData);

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

// Function to apply cross-graph mastery colors based on personal knowledge progress
function applyCrossGraphMastery(svgElement, graphType, masteryData) {
  if (!svgElement || !masteryData || graphType === 'personal') return;

  // Get mastery data for this graph type
  const graphMastery = masteryData[graphType];
  if (!graphMastery || Object.keys(graphMastery).length === 0) return;

  // Batch DOM operations for performance
  const nodesToUpdate = [];
  const nodeGroups = svgElement.querySelectorAll('g.node');

  // First pass: identify nodes that need updates
  nodeGroups.forEach(nodeGroup => {
    const textElement = nodeGroup.querySelector('text');
    if (!textElement) return;

    const nodeText = textElement.textContent || '';
    const normalizedText = normalizeLabel(nodeText);
    const mastery = graphMastery[normalizedText];

    if (mastery) {
      nodesToUpdate.push({
        nodeGroup,
        textElement,
        mastery
      });
    }
  });

  // Second pass: batch apply all updates
  nodesToUpdate.forEach(({ nodeGroup, textElement, mastery }) => {
    const rect = nodeGroup.querySelector('rect, circle, polygon');
    if (!rect) return;

    // Apply mastery colors with optimized approach
    if (mastery === 'known') {
      // Green for known concepts
      rect.style.cssText = 'fill: #1b5e20; stroke: #2e7d32; stroke-width: 3px;';
      textElement.style.cssText = 'fill: #ffffff; font-weight: 600;';
    } else if (mastery === 'learning') {
      // Amber/yellow for learning concepts
      rect.style.cssText = 'fill: #524600; stroke: #d4af37; stroke-width: 3px;';
      textElement.style.cssText = 'fill: #ffffff; font-weight: 600;';
    }
  });
}

// Simple normalization function (matching server-side logic)
function normalizeLabel(s) {
  return String(s).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Helper function to count nodes in mermaid text
function countNodesInMermaid(mermaidText) {
  const nodeMatches = mermaidText.match(/\w+\["[^"]+"\]/g) || [];
  return nodeMatches.length;
}

// Function to wrap long text in SVG text elements
function wrapSVGText(svgElement, maxCharsPerLine = 16) {
  if (!svgElement) return;

  const textElements = svgElement.querySelectorAll('g.node text');
  textElements.forEach(textEl => {
    const originalText = textEl.textContent || '';
    if (originalText.length <= maxCharsPerLine) return;

    // Clear existing content
    textEl.innerHTML = '';

    // Split into words and create lines
    const words = originalText.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
      if (currentLine.length + word.length + 1 <= maxCharsPerLine) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          // Single word longer than maxCharsPerLine, break it
          lines.push(word.substring(0, maxCharsPerLine));
          if (word.length > maxCharsPerLine) {
            lines.push(word.substring(maxCharsPerLine));
          }
          currentLine = '';
        }
      }
    });
    if (currentLine) lines.push(currentLine);

    // Create tspan elements for each line
    const lineHeight = 1.2;
    const fontSize = 11;
    const startY = parseFloat(textEl.getAttribute('y') || '0');

    lines.forEach((line, index) => {
      const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      tspan.textContent = line;
      tspan.setAttribute('x', textEl.getAttribute('x') || '0');
      tspan.setAttribute('y', startY + (index * fontSize * lineHeight));
      tspan.setAttribute('dy', index === 0 ? '0' : `${fontSize * lineHeight}px`);
      textEl.appendChild(tspan);
    });

    // Adjust the parent rect height if needed
    const nodeGroup = textEl.closest('g.node');
    if (nodeGroup && lines.length > 1) {
      const rect = nodeGroup.querySelector('rect');
      if (rect) {
        const currentHeight = parseFloat(rect.getAttribute('height') || '40');
        const newHeight = Math.max(currentHeight, (lines.length * fontSize * lineHeight) + 20);
        rect.setAttribute('height', newHeight.toString());
      }
    }
  });
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

  // Store mastery data for cross-graph synchronization
  masteryData = data.mastery;

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
      svgElement.style.fontSize = '11px'; // Consistent font size in modal
      
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
        text.style.fontSize = '11px';
        text.style.fontFamily = 'Inter, sans-serif';
      });
      
      // Apply text wrapping, graph-specific colors, and cross-graph mastery to modal graph
      wrapSVGText(svgElement, 16);
      applyGraphTypeColors(svgElement, graphType);
      applyCrossGraphMastery(svgElement, graphType, masteryData);
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
        openGraphModal('World Knowledge', lastData.mermaid.dg, 'domain');
      }
    });
  }
  
  if (sgCard) {
    sgCard.addEventListener('click', () => {
      if (lastData?.mermaid?.sg) {
        openGraphModal('Course Knowledge', lastData.mermaid.sg, 'syllabus');
      }
    });
  }
  
  if (pgCard) {
    pgCard.addEventListener('click', () => {
      if (lastData?.mermaid?.pg) {
        openGraphModal('Your Knowledge', lastData.mermaid.pg, 'personal');
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

// Data loading functions for new sections
async function loadLearningGaps() {
  try {
    console.log('Loading learning gaps...');
    // Don't show loading - keep content visible

    const response = await fetch('/api/learning-gaps');
    const data = await response.json();

    if (data.ok) {
      console.log('API data received:', data.statistics);
      // Update statistics
      gapsHigh.textContent = data.statistics.highPriority;
      gapsMedium.textContent = data.statistics.mediumPriority;
      gapsTotal.textContent = data.statistics.totalGaps;

      // Clear and populate gaps modules
      goalsModules.innerHTML = '';
      console.log('About to process', data.gaps.length, 'gaps');

      if (data.gaps.length === 0) {
        goalsModules.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">🎉</div>
            <div class="empty-title">No Learning Gaps Detected!</div>
            <div class="empty-message">You're doing great! Keep up the excellent work.</div>
          </div>
        `;
      } else {
        data.gaps.forEach((gap, index) => {
          const gapCard = document.createElement('div');
          gapCard.className = `gap-card priority-${gap.priority}`;
          gapCard.innerHTML = `
            <div class="gap-header">
              <div class="gap-header-left">
                <div class="gap-priority-badge ${gap.priority}">
                  <span class="priority-icon">${getPriorityIcon(gap.priority)}</span>
                  <span class="priority-text">${gap.priority.toUpperCase()}</span>
                </div>
                <div class="gap-info">
                  <h4 class="gap-title">${gap.concept}</h4>
                  <div class="gap-meta">
                    <span class="gap-source">${gap.source}</span>
                    <span class="gap-separator">•</span>
                    <span class="gap-difficulty" data-difficulty="${gap.difficulty}">${gap.difficulty}</span>
                    <span class="gap-separator">•</span>
                    <span class="gap-time">⏱️ ${gap.estimatedTime}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="gap-content">
              <div class="gap-description">
                <p>${gap.learningPlan}</p>
              </div>
              <div class="gap-action-section">
                <div class="action-header">🎯 Next Step</div>
                <div class="action-content">${gap.recommendedAction}</div>
              </div>
              ${gap.relatedAssignments.length > 0 ? `
                <div class="gap-assignments">
                  <div class="assignments-header">📝 Related Assignments</div>
                  <div class="assignments-list">
                    ${gap.relatedAssignments.map(assignment =>
                      `<div class="assignment-ref ${assignment.urgency}">
                        <span class="assignment-title">${assignment.title}</span>
                        <span class="due-date">${formatDueDate(assignment.dueDate)}</span>
                      </div>`
                    ).join('')}
                  </div>
                </div>
              ` : ''}
              <div class="gap-steps">
                <details class="learning-plan-details">
                  <summary class="plan-summary">
                    📋 View Learning Plan (${gap.nextSteps.length} steps)
                  </summary>
                  <div class="plan-content">
                    <ol class="step-list">
                      ${gap.nextSteps.map((step, i) => `<li class="step-item"><span class="step-number">${i + 1}</span>${step}</li>`).join('')}
                    </ol>
                  </div>
                </details>
              </div>
            </div>
          `;
          goalsModules.appendChild(gapCard);
        });
      }

      // Show pagination info if there are more gaps
      if (data.allGapsCount > data.gaps.length) {
        const paginationDiv = document.createElement('div');
        paginationDiv.className = 'gaps-pagination';
        paginationDiv.innerHTML = `
          <div class="pagination-info">
            Showing top ${data.gaps.length} of ${data.allGapsCount} learning gaps
          </div>
          <div class="pagination-note">
            💡 Start learning to see more personalized recommendations
          </div>
        `;
        goalsModules.appendChild(paginationDiv);
      }

      // Show insights if available
      if (data.insights && data.insights.length > 0) {
        const insightsDiv = document.createElement('div');
        insightsDiv.className = 'learning-insights';
        insightsDiv.innerHTML = `
          <h4>💡 Learning Insights</h4>
          ${data.insights.map(insight => `
            <div class="insight ${insight.type}">
              <div class="insight-message">${insight.message}</div>
              <div class="insight-action">${insight.action}</div>
            </div>
          `).join('')}
        `;
        goalsModules.appendChild(insightsDiv);
      }

      // Content is already visible, just ensure it stays that way
      goalsLoading.style.display = 'none';
      goalsContent.style.display = 'block';
      console.log('Learning gaps loaded successfully');
    }
  } catch (error) {
    console.error('Failed to load learning gaps:', error);
    goalsLoading.style.display = 'none';
    goalsModules.innerHTML = '<div class="error-state">Failed to load learning gaps</div>';
    goalsContent.style.display = 'block';
  }
}

function getPriorityIcon(priority) {
  switch (priority) {
    case 'high': return '⚡';
    case 'medium': return '📚';
    case 'low': return '💡';
    default: return '📝';
  }
}

function getDifficultyColor(difficulty) {
  switch (difficulty) {
    case 'easy': return '#10b981';
    case 'medium': return '#f59e0b';
    case 'hard':
    case 'high': return '#ef4444';
    default: return '#6b7280';
  }
}

function formatDueDate(dueDate) {
  const date = new Date(dueDate);
  const now = new Date();
  const daysUntilDue = Math.ceil((date - now) / (1000 * 60 * 60 * 24));

  if (daysUntilDue < 0) return 'Overdue';
  if (daysUntilDue === 0) return 'Due today';
  if (daysUntilDue === 1) return 'Due tomorrow';
  if (daysUntilDue <= 7) return `Due in ${daysUntilDue} days`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

function formatDueDateWithDays(dueDate) {
  const date = new Date(dueDate);
  const now = new Date();
  const daysUntilDue = Math.ceil((date - now) / (1000 * 60 * 60 * 24));

  if (daysUntilDue < 0) {
    const daysOverdue = Math.abs(daysUntilDue);
    return `Overdue by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`;
  }
  if (daysUntilDue === 0) return 'Due today';
  if (daysUntilDue === 1) return 'Due tomorrow';
  return `${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'} left`;
}

async function loadAssignments() {
  try {
    console.log('Loading assignments...');

    // Only show loading if content is empty
    if (assignmentsList.children.length === 0) {
      assignmentsLoading.style.display = 'block';
      assignmentsContent.style.display = 'none';
    }

    const response = await fetch('/api/assignments');
    const data = await response.json();

    if (data.ok) {
      // Update statistics
      assignmentsPending.textContent = data.summary.pending;
      assignmentsOverdue.textContent = data.summary.overdue;
      assignmentsCompleted.textContent = data.summary.completed;

      // Populate assignments list
      assignmentsList.innerHTML = '';

      if (data.assignments.length === 0) {
        assignmentsList.innerHTML = '<div class="empty-state">No assignments found</div>';
      } else {
        data.assignments.forEach(assignment => {
          const assignmentCard = document.createElement('div');
          assignmentCard.className = `assignment-card ${assignment.status}`;

          const dueDate = new Date(assignment.dueDate);
          const now = new Date();
          const isOverdue = assignment.status === 'pending' && dueDate < now;

          assignmentCard.innerHTML = `
            <div class="assignment-header">
              <div class="assignment-info">
                <div class="assignment-title-row">
                  <span class="assignment-icon">${assignment.categoryIcon}</span>
                  <h4 class="assignment-title">${assignment.fullTitle || assignment.title}</h4>
                  <span class="assignment-category">${assignment.category}</span>
                </div>
                <p class="assignment-course">${assignment.course}</p>
              </div>
              <div class="assignment-meta">
                <span class="assignment-points">${assignment.points} pts</span>
                <span class="assignment-status ${assignment.status} ${assignment.urgency}">${getAssignmentStatusText(assignment.status, isOverdue)}</span>
              </div>
            </div>
            <div class="assignment-details">
              <p class="assignment-description">${assignment.description}</p>
              ${assignment.instructions ? `<p class="assignment-instructions">${assignment.instructions}</p>` : ''}
              <div class="assignment-meta-row">
                <div class="assignment-due">
                  <span class="due-label">Due:</span>
                  <span class="due-date">${formatDate(dueDate)}</span>
                </div>
                <div class="assignment-time">
                  <span class="time-label">Est. Time:</span>
                  <span class="time-value">${assignment.estimatedTime}</span>
                </div>
                <div class="assignment-difficulty">
                  <span class="diff-label">Difficulty:</span>
                  <span class="diff-value" style="color: ${assignment.difficultyColor}">${assignment.difficulty}</span>
                </div>
              </div>
              <div class="assignment-readiness">
                <div class="readiness-header">
                  <span class="readiness-label">Readiness: ${assignment.readinessLevel.replace('_', ' ')}</span>
                  <span class="readiness-percent">${Math.round(assignment.readiness * 100)}%</span>
                </div>
                <div class="readiness-bar">
                  <div class="readiness-fill ${assignment.readinessLevel}" style="width: ${assignment.readiness * 100}%"></div>
                </div>
              </div>
              ${assignment.missingPrerequisites.length > 0 ? `
                <div class="missing-prereqs">
                  <span class="prereqs-label">⚠️ Missing prerequisites:</span>
                  <div class="prereqs-list">
                    ${assignment.missingPrerequisites.map(prereq =>
                      `<span class="prereq-tag missing">${prereq}</span>`
                    ).join('')}
                  </div>
                </div>
              ` : ''}
              ${assignment.relatedConcepts.length > 0 ? `
                <div class="related-concepts">
                  <span class="concepts-label">📚 Related concepts:</span>
                  <div class="concepts-list">
                    ${assignment.relatedConcepts.map(concept =>
                      `<span class="concept-tag">${concept}</span>`
                    ).join('')}
                  </div>
                </div>
              ` : ''}
              ${assignment.resources && assignment.resources.length > 0 ? `
                <div class="assignment-resources">
                  <details>
                    <summary>📖 Helpful Resources</summary>
                    <ul class="resource-list">
                      ${assignment.resources.map(resource => `<li>${resource}</li>`).join('')}
                    </ul>
                  </details>
                </div>
              ` : ''}
            </div>
          `;

          assignmentsList.appendChild(assignmentCard);
        });
      }

      // Content is already visible, just ensure it stays that way
      assignmentsLoading.style.display = 'none';
      assignmentsContent.style.display = 'block';
      console.log('Assignments loaded successfully');
    }
  } catch (error) {
    console.error('Failed to load assignments:', error);
    assignmentsLoading.style.display = 'none';
    assignmentsList.innerHTML = '<div class="error-state">Failed to load assignments</div>';
    assignmentsContent.style.display = 'block';
  }
}

function getAssignmentStatusText(status, isOverdue) {
  if (isOverdue) return 'Overdue';
  switch (status) {
    case 'pending': return 'Pending';
    case 'completed': return 'Completed';
    default: return status;
  }
}

function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

async function loadConversationSummary() {
  try {
    console.log('Loading learning history...');

    // Only show loading if content is empty
    if (conversationsSummary.children.length === 0) {
      conversationsLoading.style.display = 'block';
      conversationsContent.style.display = 'none';
    }

    const response = await fetch('/api/conversations/summary?limit=20');
    const data = await response.json();

    if (data.ok) {
      // Populate learning history
      conversationsSummary.innerHTML = '';

      const history = data.learningHistory;

      // Add learning history statistics
      const statsDiv = document.createElement('div');
      statsDiv.className = 'learning-stats';
      statsDiv.innerHTML = `
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">${history.totalConversations}</span>
            <span class="stat-label">Total Sessions</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${history.totalConceptsDetected}</span>
            <span class="stat-label">Concepts Learned</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${history.activeDays}</span>
            <span class="stat-label">Active Days</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${history.currentStreak}</span>
            <span class="stat-label">Current Streak</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${history.longestStreak}</span>
            <span class="stat-label">Best Streak</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${history.averageConceptsPerConversation}</span>
            <span class="stat-label">Avg Concepts/Session</span>
          </div>
        </div>
      `;
      conversationsSummary.appendChild(statsDiv);

      // Add insights
      if (data.insights && data.insights.length > 0) {
        const insightsDiv = document.createElement('div');
        insightsDiv.className = 'learning-insights';
        insightsDiv.innerHTML = `
          <h4>🧠 Learning Insights</h4>
          ${data.insights.map(insight => `
            <div class="insight ${insight.type}">
              <div class="insight-title">${insight.title}</div>
              <div class="insight-message">${insight.message}</div>
              <div class="insight-action">${insight.action}</div>
            </div>
          `).join('')}
        `;
        conversationsSummary.appendChild(insightsDiv);
      }

      // Add learning timeline (recent activity)
      if (data.timeline && data.timeline.length > 0) {
        const timelineDiv = document.createElement('div');
        timelineDiv.className = 'learning-timeline';
        timelineDiv.innerHTML = `
          <h4>📅 Recent Learning Activity</h4>
          <div class="timeline-items">
            ${data.timeline.slice(0, 7).map(day => `
              <div class="timeline-item">
                <div class="timeline-date">${formatTimelineDate(day.date)}</div>
                <div class="timeline-activity">
                  <span class="activity-conversations">${day.conversations} sessions</span>
                  <span class="activity-concepts">${day.conceptsDetected} concepts</span>
                  <span class="activity-intensity">📊 ${Math.round(day.learningIntensity * 10) / 10}/session</span>
                </div>
                ${day.topics.length > 0 ? `
                  <div class="timeline-topics">
                    ${day.topics.map(topic => `<span class="topic-pill">${topic}</span>`).join('')}
                  </div>
                ` : ''}
                ${day.keyMoments.length > 0 ? `
                  <div class="timeline-moments">
                    <details>
                      <summary>💡 Key moments (${day.keyMoments.length})</summary>
                      ${day.keyMoments.map(moment => `
                        <div class="key-moment">
                          <span class="moment-concepts">${moment.conceptsCount} concepts</span>
                          <span class="moment-text">${moment.text}</span>
                        </div>
                      `).join('')}
                    </details>
                  </div>
                ` : ''}
              </div>
            `).join('')}
          </div>
        `;
        conversationsSummary.appendChild(timelineDiv);
      }

      // Add topic insights
      if (data.topicInsights && data.topicInsights.length > 0) {
        const topicsDiv = document.createElement('div');
        topicsDiv.className = 'topic-insights';
        topicsDiv.innerHTML = `
          <h4>📚 Topic Exploration</h4>
          <div class="topic-grid">
            ${data.topicInsights.slice(0, 6).map(topic => `
              <div class="topic-card">
                <div class="topic-name">${topic.topic}</div>
                <div class="topic-stats">
                  <span class="topic-sessions">${topic.sessions} sessions</span>
                  <span class="topic-concepts">${topic.totalConcepts} concepts</span>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        conversationsSummary.appendChild(topicsDiv);
      }

      if (history.totalConversations === 0) {
        conversationsSummary.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">💭</div>
            <div class="empty-title">No Learning History Yet</div>
            <div class="empty-message">Start a conversation to begin building your learning timeline!</div>
          </div>
        `;
      }

      // Content is already visible, just ensure it stays that way
      conversationsLoading.style.display = 'none';
      conversationsContent.style.display = 'block';
      console.log('Learning history loaded successfully');
    }
  } catch (error) {
    console.error('Failed to load learning history:', error);
    conversationsLoading.style.display = 'none';
    conversationsSummary.innerHTML = '<div class="error-state">Failed to load learning history</div>';
    conversationsContent.style.display = 'block';
  }
}

function formatTimelineDate(dateStr) {
  const date = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

// Enhanced poll function to include new sections
async function pollEnhanced() {
  // Original poll logic
  await poll();

  // Load new sections data on first run
  if (!window.sectionsLoaded) {
    await Promise.all([
      loadLearningGaps(),
      loadAssignments(),
      loadConversationSummary()
    ]);
    window.sectionsLoaded = true;
  }
}

// Initialize
pollEnhanced();
setInterval(poll, 3000); // Back to original poll function for graphs only

// Removed test content

// Add click handlers after DOM is ready
document.addEventListener('DOMContentLoaded', addGraphClickHandlers);
// Also add handlers immediately in case DOM is already loaded
addGraphClickHandlers();
