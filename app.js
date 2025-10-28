const fileInput = document.getElementById('fileInput');
const clearButton = document.getElementById('clearButton');
const statusMessage = document.getElementById('statusMessage');
const tooltip = document.getElementById('tooltip');
const svg = d3.select('#graph');

let currentGraph = { nodes: [], edges: [] };

fileInput.addEventListener('change', handleFileUpload);
clearButton.addEventListener('click', clearGraph);
window.addEventListener('resize', () => {
  if (currentGraph.nodes.length) {
    renderGraph(currentGraph);
  }
});

async function handleFileUpload(event) {
  const files = Array.from(event.target.files || []);

  if (!files.length) {
    return;
  }

  try {
    const contents = await Promise.all(files.map(readGraphFile));
    const mergedGraph = mergeGraphs(contents);
    currentGraph = mergedGraph;
    renderGraph(mergedGraph);
    statusMessage.textContent = `Loaded ${files.length} file${
      files.length > 1 ? 's' : ''
    }: ${mergedGraph.nodes.length} node${
      mergedGraph.nodes.length !== 1 ? 's' : ''
    } and ${mergedGraph.edges.length} relation${
      mergedGraph.edges.length !== 1 ? 's' : ''
    }.`;
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

function renderGraph(graph) {
  hideTooltip();
  svg.selectAll('*').remove();

  const container = svg.node().getBoundingClientRect();
  const width = container.width || 900;
  const height = container.height || 600;
  svg.attr('viewBox', `0 0 ${width} ${height}`);

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

  const links = graph.edges.map((edge) => ({ ...edge }));
  const nodes = graph.nodes.map((node) => ({ ...node }));

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

  node
    .append('circle')
    .attr('r', 22)
    .attr('fill', '#fff')
    .attr('stroke-width', 2);

  node
    .append('text')
    .text((d) => d.name || d.id);

  const simulation = d3
    .forceSimulation(nodes)
    .force(
      'link',
      d3
        .forceLink(links)
        .id((d) => d.id)
        .distance(130)
        .strength(0.2),
    )
    .force('charge', d3.forceManyBody().strength(-350))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(60))
    .on('tick', ticked);

  function ticked() {
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node.attr('transform', (d) => `translate(${d.x}, ${d.y})`);

    linkLabels.attr('transform', (d) => {
      const x = (d.source.x + d.target.x) / 2;
      const y = (d.source.y + d.target.y) / 2;
      return `translate(${x}, ${y})`;
    });

    linkLabels.each(function (d) {
      const text = d3.select(this).select('text');
      const bbox = text.node().getBBox();
      d3.select(this)
        .select('rect')
        .attr('x', bbox.x - 6)
        .attr('y', bbox.y - 3)
        .attr('width', bbox.width + 12)
        .attr('height', bbox.height + 6);
    });
  }

  function dragStarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragEnded(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }
}

function clearGraph() {
  fileInput.value = '';
  currentGraph = { nodes: [], edges: [] };
  svg.selectAll('*').remove();
  statusMessage.textContent = 'Graph cleared. Select new files to visualize.';
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
  return `<strong>${escapeHtml(title)}</strong><br />${escapeHtml(description)}`;
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
