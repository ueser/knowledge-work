const fileInput = document.getElementById('fileInput');
const clearButton = document.getElementById('clearButton');
const statusMessage = document.getElementById('statusMessage');
const tooltip = document.getElementById('tooltip');

let svg = null;
let currentGraph = { nodes: [], edges: [] };
let currentLayout = 'force';
let forceStrength = -350;
let currentSimulation = null;
let currentMetric = 'degree';
let metricThreshold = 0;
let colorByMetric = false;
let sizeByMetric = false;
let metricsCalculated = false;

// Wait for D3 to load before initializing
function waitForD3() {
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      if (typeof d3 !== 'undefined') {
        clearInterval(checkInterval);
        resolve();
      }
    }, 50);
    // Timeout after 10 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      resolve();
    }, 10000);
  });
}

waitForD3().then(() => {
  if (typeof d3 === 'undefined') {
    console.error(
      'D3 failed to load. The visualization requires the D3 library to render.',
    );
    statusMessage.textContent =
      'Unable to initialize the visualization because the D3 library did not load. Please check your internet connection (or bundle D3 locally) and reload the page.';
    fileInput.disabled = true;
    clearButton.disabled = true;
  } else {
    svg = d3.select('#graph');
    fileInput.addEventListener('change', handleFileUpload);
    clearButton.addEventListener('click', clearGraph);

    // Layout selector
    const layoutSelect = document.getElementById('layoutSelect');
    const forceStrengthSlider = document.getElementById('forceStrength');
    layoutSelect.addEventListener('change', (e) => {
      currentLayout = e.target.value;
      // Enable/disable force strength slider based on layout
      forceStrengthSlider.disabled = currentLayout !== 'force';
      if (currentGraph.nodes.length) {
        renderGraph(currentGraph);
      }
    });

    // Force strength slider (only works in force layout)
    const forceStrengthValue = document.getElementById('forceStrengthValue');
    forceStrengthSlider.addEventListener('input', (e) => {
      forceStrength = parseInt(e.target.value);
      forceStrengthValue.textContent = forceStrength;
      if (currentGraph.nodes.length && currentSimulation && currentLayout === 'force') {
        // Update the force and reheat the simulation to see the effect
        currentSimulation.force('charge', d3.forceManyBody().strength(forceStrength));
        currentSimulation.alpha(0.3).restart();
      }
    });

    // Disable force strength slider for non-force layouts
    forceStrengthSlider.disabled = currentLayout !== 'force';

    // Metric selector
    const metricSelect = document.getElementById('metricSelect');
    metricSelect.addEventListener('change', (e) => {
      currentMetric = e.target.value;
      if (currentGraph.nodes.length && metricsCalculated) {
        updateMetricsStatus(currentGraph);
        renderGraph(currentGraph);
      }
    });

    // Metric threshold slider
    const metricThresholdSlider = document.getElementById('metricThreshold');
    const metricThresholdValue = document.getElementById('metricThresholdValue');
    metricThresholdSlider.addEventListener('input', (e) => {
      metricThreshold = parseInt(e.target.value) / 100;
      metricThresholdValue.textContent = e.target.value + '%';
      if (currentGraph.nodes.length && metricsCalculated) {
        renderGraph(currentGraph);
      }
    });

    // Color by metric checkbox
    const colorByMetricCheckbox = document.getElementById('colorByMetric');
    colorByMetricCheckbox.addEventListener('change', (e) => {
      colorByMetric = e.target.checked;
      if (currentGraph.nodes.length && metricsCalculated) {
        renderGraph(currentGraph);
      }
    });

    // Size by metric checkbox
    const sizeByMetricCheckbox = document.getElementById('sizeByMetric');
    sizeByMetricCheckbox.addEventListener('change', (e) => {
      sizeByMetric = e.target.checked;
      if (currentGraph.nodes.length && metricsCalculated) {
        renderGraph(currentGraph);
      }
    });

    window.addEventListener('resize', () => {
      if (currentGraph.nodes.length) {
        renderGraph(currentGraph);
      }
    });
  }
});

async function handleFileUpload(event) {
  if (!svg) {
    statusMessage.textContent =
      'Cannot load the graph because the visualization library is unavailable.';
    return;
  }

  const files = Array.from(event.target.files || []);

  if (!files.length) {
    return;
  }

  try {
    const contents = await Promise.all(files.map(readGraphFile));
    // Merge new files with existing graph
    const graphsToMerge = currentGraph.nodes.length > 0 ? [currentGraph, ...contents] : contents;
    let mergedGraph = mergeGraphs(graphsToMerge);
    // Calculate metrics
    mergedGraph = calculateMetrics(mergedGraph);
    currentGraph = mergedGraph;
    renderGraph(mergedGraph);
    statusMessage.textContent = `Loaded ${files.length} file${
      files.length > 1 ? 's' : ''
    }: ${mergedGraph.nodes.length} node${
      mergedGraph.nodes.length !== 1 ? 's' : ''
    } and ${mergedGraph.edges.length} relation${
      mergedGraph.edges.length !== 1 ? 's' : ''
    }.`;
    // Clear the file input so the same files can be uploaded again if needed
    event.target.value = '';
  } catch (error) {
    console.error(error);
    statusMessage.textContent = `Error: ${error.message}`;
  }
}

function readGraphFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        validateGraph(data, file.name);
        resolve(data);
      } catch (error) {
        reject(new Error(`Failed to parse ${file.name}: ${error.message}`));
      }
    };

    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.readAsText(file);
  });
}

function validateGraph(graph, fileName) {
  if (!graph || typeof graph !== 'object') {
    throw new Error(`Graph in ${fileName} must be an object.`);
  }

  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error(
      `Graph in ${fileName} must include "nodes" and "edges" arrays.`,
    );
  }

  graph.nodes.forEach((node, index) => {
    if (!node || typeof node !== 'object' || !node.id) {
      throw new Error(
        `Node at index ${index} in ${fileName} must include an "id" field.`,
      );
    }
  });

  graph.edges.forEach((edge, index) => {
    if (!edge || typeof edge !== 'object' || !edge.source || !edge.target) {
      throw new Error(
        `Edge at index ${index} in ${fileName} must include "source" and "target" fields.`,
      );
    }
  });
}

function mergeGraphs(graphs) {
  const nodeMap = new Map();
  const edgeMap = new Map();

  graphs.forEach((graph) => {
    graph.nodes.forEach((node) => {
      const existing = nodeMap.get(node.id);
      if (!existing) {
        nodeMap.set(node.id, { ...node });
      } else {
        // Prefer the first non-empty description encountered.
        if (!existing.description && node.description) {
          existing.description = node.description;
        }
        if (!existing.name && node.name) {
          existing.name = node.name;
        }
      }
    });

    graph.edges.forEach((edge) => {
      const key = `${edge.source}|${edge.target}|${edge.relation}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          source: edge.source,
          target: edge.target,
          relation: edge.relation,
          reference: Array.isArray(edge.reference)
            ? [...new Set(edge.reference)]
            : [],
        });
      } else {
        const existing = edgeMap.get(key);
        const refs = new Set(existing.reference);
        (Array.isArray(edge.reference) ? edge.reference : []).forEach((ref) =>
          refs.add(ref),
        );
        existing.reference = [...refs];
      }
    });
  });

  edgeMap.forEach((edge) => {
    if (!nodeMap.has(edge.source)) {
      nodeMap.set(edge.source, {
        id: edge.source,
        name: edge.source,
        description: 'Placeholder node (no details provided).',
      });
    }
    if (!nodeMap.has(edge.target)) {
      nodeMap.set(edge.target, {
        id: edge.target,
        name: edge.target,
        description: 'Placeholder node (no details provided).',
      });
    }
  });

  const nodes = Array.from(nodeMap.values()).sort((a, b) =>
    (a.name || a.id || '').localeCompare(b.name || b.id || ''),
  );
  const edges = Array.from(edgeMap.values());

  return { nodes, edges };
}

function calculateMetrics(graph) {
  // Check if Graphology is available
  if (typeof graphology === 'undefined' || typeof graphologyMetrics === 'undefined') {
    console.warn('Graphology not loaded. Metrics unavailable.');
    return graph;
  }

  try {
    // Create a directed graph
    const g = new graphology.DirectedGraph();

    // Add nodes
    graph.nodes.forEach(node => {
      g.addNode(node.id, { ...node });
    });

    // Add edges
    graph.edges.forEach(edge => {
      const source = typeof edge.source === 'object' ? edge.source.id : edge.source;
      const target = typeof edge.target === 'object' ? edge.target.id : edge.target;

      if (g.hasNode(source) && g.hasNode(target) && !g.hasEdge(source, target)) {
        g.addEdge(source, target, { ...edge });
      }
    });

    // Calculate metrics
    const pageRank = graphologyMetrics.centrality.pagerank(g, { alpha: 0.85, tolerance: 0.0001 });
    const betweenness = graphologyMetrics.centrality.betweenness(g);
    const closeness = graphologyMetrics.centrality.closeness(g);

    // Normalize metrics to 0-1 range
    const normalize = (values) => {
      const vals = Object.values(values);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const range = max - min;
      if (range === 0) return values;
      const normalized = {};
      Object.keys(values).forEach(key => {
        normalized[key] = (values[key] - min) / range;
      });
      return normalized;
    };

    const normalizedPageRank = normalize(pageRank);
    const normalizedBetweenness = normalize(betweenness);
    const normalizedCloseness = normalize(closeness);

    // Calculate max degree for normalization
    let maxDegree = 0;
    graph.nodes.forEach(node => {
      const degree = g.degree(node.id);
      if (degree > maxDegree) maxDegree = degree;
    });

    // Attach metrics to nodes
    graph.nodes.forEach(node => {
      const degree = g.degree(node.id);
      node.degree = degree;
      node.inDegree = g.inDegree(node.id);
      node.outDegree = g.outDegree(node.id);
      node.normalizedDegree = maxDegree > 0 ? degree / maxDegree : 0;
      node.pagerank = normalizedPageRank[node.id] || 0;
      node.betweenness = normalizedBetweenness[node.id] || 0;
      node.closeness = normalizedCloseness[node.id] || 0;
    });

    metricsCalculated = true;
    updateMetricsStatus(graph);

    console.log('Metrics calculated successfully');
    return graph;
  } catch (error) {
    console.error('Error calculating metrics:', error);
    metricsCalculated = false;
    return graph;
  }
}

function updateMetricsStatus(graph) {
  const metricsStatusEl = document.getElementById('metricsStatus');
  if (!metricsStatusEl || !metricsCalculated) return;

  // Get current metric values
  const metricKey = currentMetric === 'degree' ? 'normalizedDegree' : currentMetric;
  const values = graph.nodes.map(n => n[metricKey] || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  // Find top 3 nodes
  const sorted = [...graph.nodes].sort((a, b) => (b[metricKey] || 0) - (a[metricKey] || 0));
  const top3 = sorted.slice(0, 3).map(n => `${n.name || n.id} (${((n[metricKey] || 0) * 100).toFixed(1)}%)`);

  metricsStatusEl.innerHTML = `
    <strong>${currentMetric.charAt(0).toUpperCase() + currentMetric.slice(1)}:</strong>
    Min: ${(min * 100).toFixed(1)}%, Max: ${(max * 100).toFixed(1)}%, Avg: ${(mean * 100).toFixed(1)}%
    | Top 3: ${top3.join(', ')}
  `;
}

function renderGraph(graph) {
  if (!svg) {
    return;
  }

  hideTooltip();
  svg.selectAll('*').remove();

  const svgNode = svg.node();
  const parentElement = svgNode.parentElement;
  const width = parentElement.clientWidth || 900;
  const height = parentElement.clientHeight || 600;
  svg.attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  const defs = svg.append('defs');
  defs
    .append('marker')
    .attr('id', 'arrowhead')
    .attr('viewBox', '-0 -5 10 10')
    .attr('refX', 22)
    .attr('refY', 0)
    .attr('orient', 'auto')
    .attr('markerWidth', 8)
    .attr('markerHeight', 8)
    .attr('xoverflow', 'visible')
    .append('svg:path')
    .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
    .attr('fill', 'rgba(79, 70, 229, 0.75)');

  const linkGroup = svg.append('g').attr('class', 'links');
  const labelGroup = svg.append('g').attr('class', 'labels');
  const nodeGroup = svg.append('g').attr('class', 'nodes');

  // Create node lookup map for link resolution (needs to be accessible in ticked())
  const nodeMap = new Map();
  const nodes = graph.nodes.map((node) => {
    const n = { ...node };
    // Reset position properties to allow fresh layout calculation
    delete n.x;
    delete n.y;
    delete n.vx;
    delete n.vy;
    delete n.fx;
    delete n.fy;
    nodeMap.set(n.id, n);
    return n;
  });

  const links = graph.edges.map((edge) => {
    const link = { ...edge };
    // Pre-resolve node references for static layouts
    link.sourceNode = nodeMap.get(link.source);
    link.targetNode = nodeMap.get(link.target);
    return link;
  });

  const link = linkGroup
    .selectAll('line')
    .data(links)
    .enter()
    .append('line')
    .attr('class', 'link')
    .attr('marker-end', 'url(#arrowhead)')
    .on('mouseenter', (event, d) =>
      showTooltip(event, formatEdgeTooltip(d)),
    )
    .on('mousemove', updateTooltipPosition)
    .on('mouseleave', hideTooltip);

  const linkLabels = labelGroup
    .selectAll('g')
    .data(links)
    .enter()
    .append('g')
    .attr('class', 'link-label-wrapper')
    .style('pointer-events', 'auto')
    .on('mouseenter', (event, d) =>
      showTooltip(event, formatEdgeTooltip(d)),
    )
    .on('mousemove', updateTooltipPosition)
    .on('mouseleave', hideTooltip);

  linkLabels
    .append('rect')
    .attr('class', 'link-label-bg')
    .attr('rx', 6)
    .attr('ry', 6)
    .attr('fill', 'rgba(255, 255, 255, 0.85)')
    .attr('stroke', 'rgba(79, 70, 229, 0.25)')
    .attr('stroke-width', 1);

  linkLabels
    .append('text')
    .attr('class', 'link-label')
    .attr('text-anchor', 'middle')
    .attr('alignment-baseline', 'middle')
    .text((d) => d.relation || '');

  const node = nodeGroup
    .selectAll('g')
    .data(nodes)
    .enter()
    .append('g')
    .attr('class', 'node')
    .call(
      d3
        .drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded),
    )
    .on('mouseenter', (event, d) =>
      showTooltip(event, formatNodeTooltip(d)),
    )
    .on('mousemove', updateTooltipPosition)
    .on('mouseleave', hideTooltip);

  // Create color scale for metrics - using Viridis for better visibility
  const colorScale = d3.scaleSequential(d3.interpolateViridis).domain([0, 1]);

  // Get metric key for current metric
  const metricKey = currentMetric === 'degree' ? 'normalizedDegree' : currentMetric;

  node
    .append('circle')
    .attr('r', (d) => {
      if (!sizeByMetric || !metricsCalculated) return 22;
      // Map metric value to radius 10-40
      const metricValue = d[metricKey] || 0;
      return 10 + metricValue * 30;
    })
    .attr('fill', (d) => {
      if (!colorByMetric || !metricsCalculated) return '#fff';
      const metricValue = d[metricKey] || 0;
      return colorScale(metricValue);
    })
    .attr('stroke-width', 2);

  node
    .append('text')
    .text((d) => d.name || d.id);

  // Initialize node positions based on layout type
  if (currentLayout === 'circular' && nodes.length > 0) {
    const radius = Math.min(width, height) / 3;
    // Sort by metric if metrics are available
    let sortedNodes = nodes;
    if (metricsCalculated) {
      sortedNodes = [...nodes].sort((a, b) => (b[metricKey] || 0) - (a[metricKey] || 0));
    }
    sortedNodes.forEach((d, i) => {
      const angle = (i / sortedNodes.length) * 2 * Math.PI;
      d.x = width / 2 + radius * Math.cos(angle);
      d.y = height / 2 + radius * Math.sin(angle);
    });
  } else if (currentLayout === 'hierarchical' && nodes.length > 0) {
    // Sort nodes by selected metric (or degree if metrics not calculated)
    let sortedNodes;
    if (metricsCalculated) {
      sortedNodes = [...nodes].sort((a, b) => (b[metricKey] || 0) - (a[metricKey] || 0));
    } else {
      // Fallback to degree-based sorting
      const degrees = new Map();
      links.forEach((link) => {
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        degrees.set(sourceId, (degrees.get(sourceId) || 0) + 1);
        degrees.set(targetId, (degrees.get(targetId) || 0) + 1);
      });
      sortedNodes = [...nodes].sort((a, b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0));
    }

    const layers = Math.ceil(Math.sqrt(nodes.length));
    const nodesPerLayer = Math.ceil(nodes.length / layers);
    sortedNodes.forEach((d, i) => {
      const layer = Math.floor(i / nodesPerLayer);
      const posInLayer = i % nodesPerLayer;
      d.x = (posInLayer + 0.5) * (width / nodesPerLayer);
      d.y = (layer + 1) * (height / (layers + 1));
      // Ensure values are valid numbers
      if (!isFinite(d.x)) d.x = width / 2;
      if (!isFinite(d.y)) d.y = height / 2;
    });
  } else {
    // Force layout - initialize nodes with center position + small random offset
    nodes.forEach((d) => {
      if (!d.x) d.x = width / 2 + (Math.random() - 0.5) * 100;
      if (!d.y) d.y = height / 2 + (Math.random() - 0.5) * 100;
    });
  }

  // Stop any existing simulation to prevent it from modifying our data
  if (currentSimulation) {
    currentSimulation.stop();
  }

  let simulation;

  if (currentLayout === 'force') {
    // Force layout with full simulation
    // IMPORTANT: forceLink will modify links array, replacing source/target strings with node references

    // Add padding to keep nodes comfortably inside viewport
    const padding = 50;

    simulation = d3.forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink(links)
          .id((d) => d.id)
          .distance(130)
          .strength(0.2),
      )
      .force('charge', d3.forceManyBody().strength(forceStrength))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(60))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05))
      .alpha(1)
      .restart()
      .on('tick', () => {
        // Constrain nodes to viewport with padding
        nodes.forEach(d => {
          d.x = Math.max(padding, Math.min(width - padding, d.x));
          d.y = Math.max(padding, Math.min(height - padding, d.y));
        });
        ticked();
      });
  } else {
    // Circular and hierarchical: static layout, no simulation
    // Just render the initial positions once
    ticked();
  }

  // Store simulation for real-time force adjustment
  currentSimulation = simulation;

  // Apply metric-based filtering
  if (metricsCalculated && metricThreshold > 0) {
    node.classed('dimmed', (d) => {
      const metricValue = d[metricKey] || 0;
      return metricValue < metricThreshold;
    });

    // Dim links connected to dimmed nodes
    link.classed('dimmed', (d) => {
      let source, target;
      if (typeof d.source === 'object' && d.source) {
        source = nodeMap.get(d.source.id || d.source);
      } else {
        source = d.sourceNode;
      }
      if (typeof d.target === 'object' && d.target) {
        target = nodeMap.get(d.target.id || d.target);
      } else {
        target = d.targetNode;
      }

      const sourceMetric = source ? (source[metricKey] || 0) : 0;
      const targetMetric = target ? (target[metricKey] || 0) : 0;
      return sourceMetric < metricThreshold || targetMetric < metricThreshold;
    });
  } else {
    // Remove dimming if no threshold
    node.classed('dimmed', false);
    link.classed('dimmed', false);
  }

  function ticked() {
    link
      .attr('x1', (d) => {
        let source;
        if (typeof d.source === 'object' && d.source) {
          source = nodeMap.get(d.source.id || d.source);
        } else {
          source = d.sourceNode;
        }
        const x = source ? source.x : 0;
        return isFinite(x) ? x : 0;
      })
      .attr('y1', (d) => {
        let source;
        if (typeof d.source === 'object' && d.source) {
          source = nodeMap.get(d.source.id || d.source);
        } else {
          source = d.sourceNode;
        }
        const y = source ? source.y : 0;
        return isFinite(y) ? y : 0;
      })
      .attr('x2', (d) => {
        let target;
        if (typeof d.target === 'object' && d.target) {
          target = nodeMap.get(d.target.id || d.target);
        } else {
          target = d.targetNode;
        }
        const x = target ? target.x : 0;
        return isFinite(x) ? x : 0;
      })
      .attr('y2', (d) => {
        let target;
        if (typeof d.target === 'object' && d.target) {
          target = nodeMap.get(d.target.id || d.target);
        } else {
          target = d.targetNode;
        }
        const y = target ? target.y : 0;
        return isFinite(y) ? y : 0;
      });

    node.attr('transform', (d) => {
      const x = isFinite(d.x) ? d.x : 0;
      const y = isFinite(d.y) ? d.y : 0;
      if (!isFinite(d.x) || !isFinite(d.y)) {
        console.warn(`Node ${d.id}: invalid position (${d.x}, ${d.y}), using (${x}, ${y})`);
      }
      return `translate(${x}, ${y})`;
    });

    linkLabels.attr('transform', (d) => {
      // In force layout, d.source/d.target are node objects
      // In static layouts, they might be strings so use sourceNode/targetNode
      let source, target;
      if (typeof d.source === 'object' && d.source) {
        // Force layout has resolved these to node objects
        // But they might be OLD node objects from a previous render
        // So look them up by ID in the current nodeMap
        source = nodeMap.get(d.source.id || d.source);
      } else {
        // Static layout - use pre-resolved nodes
        source = d.sourceNode;
      }

      if (typeof d.target === 'object' && d.target) {
        target = nodeMap.get(d.target.id || d.target);
      } else {
        target = d.targetNode;
      }
      if (!source || !target) {
        return `translate(0, 0)`;
      }
      const x = (source.x + target.x) / 2;
      const y = (source.y + target.y) / 2;
      if (!isFinite(x) || !isFinite(y)) {
        return `translate(0, 0)`;
      }
      return `translate(${x}, ${y})`;
    });

    linkLabels.each(function (d) {
      const text = d3.select(this).select('text');
      const textNode = text.node();
      if (!textNode) return; // Skip if text node doesn't exist yet
      const bbox = textNode.getBBox();
      d3.select(this)
        .select('rect')
        .attr('x', bbox.x - 6)
        .attr('y', bbox.y - 3)
        .attr('width', bbox.width + 12)
        .attr('height', bbox.height + 6);
    });
  }

  function dragStarted(event, d) {
    if (simulation && !event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    // Constrain drag position to viewport with padding
    const padding = 50;
    const constrainedX = Math.max(padding, Math.min(width - padding, event.x));
    const constrainedY = Math.max(padding, Math.min(height - padding, event.y));

    d.fx = constrainedX;
    d.fy = constrainedY;

    // For static layouts, update positions immediately and re-render
    if (!simulation) {
      d.x = constrainedX;
      d.y = constrainedY;
      ticked();
    }
  }

  function dragEnded(event, d) {
    if (simulation && !event.active) simulation.alphaTarget(0);

    // For static layouts, keep the dragged position
    if (!simulation) {
      d.x = event.x;
      d.y = event.y;
      d.fx = null;
      d.fy = null;
    } else {
      // For force layout, release the fixed position
      d.fx = null;
      d.fy = null;
    }
  }
}

function clearGraph() {
  fileInput.value = '';
  currentGraph = { nodes: [], edges: [] };
  if (svg) {
    svg.selectAll('*').remove();
    statusMessage.textContent = 'Graph cleared. Select new files to visualize.';
  }
  hideTooltip();
}

function showTooltip(event, content) {
  tooltip.innerHTML = content;
  tooltip.classList.add('visible');
  updateTooltipPosition(event);
}

function updateTooltipPosition(event) {
  const offset = 18;
  tooltip.style.left = `${event.clientX + offset}px`;
  tooltip.style.top = `${event.clientY - offset}px`;
}

function hideTooltip() {
  tooltip.classList.remove('visible');
}

function formatNodeTooltip(node) {
  const title = node.name || node.id || 'Node';
  const description = node.description ? node.description : 'No description';

  let metricsHtml = '';
  if (metricsCalculated) {
    metricsHtml = `
      <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(255, 255, 255, 0.2);">
        <div class="tooltip-meta">Graph Metrics</div>
        <strong>Degree:</strong> ${node.degree || 0} (in: ${node.inDegree || 0}, out: ${node.outDegree || 0})<br/>
        <strong>PageRank:</strong> ${((node.pagerank || 0) * 100).toFixed(1)}%<br/>
        <strong>Betweenness:</strong> ${((node.betweenness || 0) * 100).toFixed(1)}%<br/>
        <strong>Closeness:</strong> ${((node.closeness || 0) * 100).toFixed(1)}%
      </div>
    `;
  }

  return `<strong>${escapeHtml(title)}</strong><br />${escapeHtml(description)}${metricsHtml}`;
}

function formatEdgeTooltip(edge) {
  const references = Array.isArray(edge.reference) ? edge.reference : [];
  const referenceList =
    references.length === 0
      ? '<em>No references</em>'
      : `<ul>${references
          .map((ref) => `<li>${escapeHtml(ref)}</li>`)
          .join('')}</ul>`;
  const title = escapeHtml(edge.relation || 'Relation');
  const source = escapeHtml(edge.source || '');
  const target = escapeHtml(edge.target || '');
  return `<strong>${title}</strong><div class="tooltip-meta">${source} → ${target}</div>${referenceList}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
