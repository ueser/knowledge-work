# Knowledge Graph Visualizer

A lightweight, client-side web application for exploring knowledge graphs. Upload one or more JSON files, merge shared nodes automatically, and explore the combined graph interactively with tooltips for node descriptions and relation references.

## Getting started

1. Open `index.html` in your browser. No build step or server is required.
2. Click **Select JSON files** and choose one or more files that match the expected schema.
3. Drag nodes to rearrange the layout. Hover over nodes to view their descriptions and over relations to see any attached references.
4. Use **Clear graph** to remove the current visualization and load new files.

## JSON schema

```json
{
  "nodes": [
    {
      "name": "Node label",
      "id": "node_label",
      "description": "Details about this node"
    }
  ],
  "edges": [
    {
      "source": "node_label",
      "target": "other_node",
      "relation": "connects_to",
      "reference": ["https://example.com"]
    }
  ]
}
```

When multiple files reference the same node (using identical `id` values), the visualizer automatically merges them and combines references on matching relations.
