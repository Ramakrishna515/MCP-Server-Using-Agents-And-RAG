# Model Context Protocol (MCP) - Complete Guide

## Table of Contents

- [What is MCP?](#what-is-mcp)
- [Why MCP?](#why-mcp)
- [Architecture Overview](#architecture-overview)
- [Core Concepts](#core-concepts)
- [How MCP Works](#how-mcp-works)
- [Building an MCP Server](#building-an-mcp-server)
- [Building an MCP Client](#building-an-mcp-client)
- [Real-World Examples](#real-world-examples)
- [Advanced Topics](#advanced-topics)
- [Best Practices](#best-practices)

---

## What is MCP?

**MCP (Model Context Protocol)** is an open protocol that standardizes how AI applications provide context to LLMs. Think of it as a **universal adapter** that connects AI models to external tools, data sources, and services.

### Simple Analogy

Imagine you have a smart assistant (AI model) that needs to:
- Read files from your computer
- Query a database
- Search the web
- Control a music player

Without MCP, you'd need to build custom integrations for each one. With MCP, there's a **standardized way** to connect to all of them.

```
┌─────────────────┐
│   AI Model      │
│   (Claude, GPT) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   MCP Client    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   MCP Server    │ ← Talks to tools/data
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ Files  │ │Database│
└────────┘ └────────┘
```

---

## Why MCP?

### Before MCP (The Problem)

```
AI App ──┬── Custom integration for File System
         ├── Custom integration for Database
         ├── Custom integration for GitHub
         ├── Custom integration for Slack
         └── Custom integration for ... (100+ more)
```

**Problems:**
1. **N×M Problem**: N AI apps × M tools = N×M integrations
2. **Inconsistent**: Every integration works differently
3. **Fragile**: Breaking changes in one tool affect all apps
4. **Duplicated Effort**: Everyone rebuilds the same integrations

### With MCP (The Solution)

```
AI App 1 ──┬── MCP ──┬── File System MCP Server
AI App 2 ──┤         ├── Database MCP Server
AI App 3 ──┘         ├── GitHub MCP Server
                      ├── Slack MCP Server
                      └── ... (100+ more)
```

**Benefits:**
1. **N+M Solution**: N AI apps + M MCP servers = N+M integrations
2. **Standardized**: One protocol, one way to connect
3. **Composable**: Mix and match servers freely
4. **Community-Driven**: Build once, use everywhere

---

## Architecture Overview

### The Three Players

```
┌─────────────────────────────────────────────────────────┐
│                    Host Application                      │
│                    (e.g., IDE, Chat App)                 │
│                                                         │
│  ┌─────────────────┐         ┌─────────────────┐       │
│  │   MCP Client    │◄───────►│   MCP Client    │       │
│  └────────┬────────┘         └────────┬────────┘       │
└───────────┼───────────────────────────┼─────────────────┘
            │                           │
            ▼                           ▼
┌───────────────────┐       ┌───────────────────┐
│   MCP Server A    │       │   MCP Server B    │
│   (File System)   │       │   (Database)      │
└───────────────────┘       └───────────────────┘
```

| Component | Role | Example |
|-----------|------|---------|
| **Host** | The AI application that orchestrates everything | Claude Desktop, VS Code, custom chat app |
| **Client** | Maintains 1:1 connection with a server, handles protocol | Part of the host application |
| **Server** | Exposes tools, resources, and prompts to the AI | File server, database server, API server |

### Communication Flow

```
User: "Read my notes.md file"
          │
          ▼
    ┌─────────┐
    │  Host   │
    └────┬────┘
         │ 1. Routes request to appropriate client
         ▼
    ┌─────────┐
    │ Client  │
    └────┬────┘
         │ 2. Calls server tool via JSON-RPC
         ▼
    ┌─────────┐
    │ Server  │
    └────┬────┘
         │ 3. Executes: reads notes.md from disk
         │
         ▼
    Returns: "File contents of notes.md"
```

---

## Core Concepts

### 1. Tools (Model-Controlled)

**Tools** are functions the AI can call to perform actions. The AI decides when to use them based on the user's request.

```typescript
// Example: A tool that reads a file
{
  name: "read_file",
  description: "Read the contents of a file",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file"
      }
    },
    required: ["path"]
  }
}
```

**When to use Tools:**
- Database queries
- API calls
- File operations
- Running commands
- Sending emails

### 2. Resources (Application-Controlled)

**Resources** provide data to the AI. The host application decides when to fetch them.

```typescript
// Example: A resource exposing a config file
{
  uri: "config://app/settings",
  name: "App Settings",
  mimeType: "application/json",
  description: "Application configuration"
}
```

**When to use Resources:**
- Static configuration
- File contents
- Database schemas
- API documentation
- Log files

### 3. Prompts (User-Controlled)

**Prompts** are reusable templates that help users accomplish specific tasks.

```typescript
// Example: A prompt for code review
{
  name: "code_review",
  description: "Review code for issues",
  arguments: [
    {
      name: "code",
      description: "The code to review",
      required: true
    }
  ]
}
```

**When to use Prompts:**
- Code review templates
- Debugging helpers
- Documentation generators
- Testing scenarios

---

## How MCP Works

### The Protocol Stack

```
┌──────────────────────────────┐
│       Application Layer      │  ← Your code (tools, resources)
├──────────────────────────────┤
│       MCP Protocol Layer     │  ← Protocol messages & lifecycle
├──────────────────────────────┤
│       Transport Layer        │  ← How messages are sent
├──────────────────────────────┤
│       Network Layer          │  ← TCP, WebSocket, etc.
└──────────────────────────────┘
```

### Transport Mechanisms

MCP supports different transport types:

#### 1. stdio (Standard I/O) - Most Common
```
Host ──[stdin]──► Server
Host ◄──[stdout]── Server
```

- Server runs as a subprocess
- Communication via standard input/output
- Simple, no network config needed
- Used by: Claude Desktop, most CLI tools

#### 2. HTTP with SSE (Server-Sent Events)
```
Host ──[HTTP POST]──► Server (send messages)
Host ◄──[SSE]── Server (receive messages)
```

- Server runs as a web server
- Good for remote servers
- Works over the internet
- Used by: Web-based tools, remote servers

#### 3. WebSocket
```
Host ◄────[WebSocket]────► Server (bidirectional)
```

- Full-duplex communication
- Good for real-time updates
- Used by: Complex interactive tools

### Message Types

MCP uses **JSON-RPC 2.0** for all communication:

#### Request (Client → Server)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "read_file",
    "arguments": { "path": "/tmp/notes.txt" }
  }
}
```

#### Response (Server → Client)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Hello, this is the file contents!"
      }
    ]
  }
}
```

#### Error Response
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "File not found",
    "data": { "path": "/tmp/notes.txt" }
  }
}
```

---

## Building an MCP Server

### Prerequisites

```bash
# Install Node.js (v18+)
# Install npm or yarn

# Create a new project
mkdir my-mcp-server
cd my-mcp-server
npm init -y

# Install MCP SDK
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node
```

### Basic Server Structure

```typescript
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// 1. Create the server
const server = new McpServer({
  name: "my-mcp-server",
  version: "1.0.0",
  description: "My awesome MCP server"
});

// 2. Register tools, resources, prompts...

// 3. Connect to transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Example 1: Hello World Server

```typescript
// src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "hello-server",
  version: "1.0.0"
});

// Register a simple tool
server.tool(
  "greet",
  "Greet someone by name",
  { name: { type: "string", description: "Name of the person" } },
  async ({ name }) => ({
    content: [
      {
        type: "text",
        text: `Hello, ${name}! Welcome to the MCP world! 🎉`
      }
    ]
  })
);

// Register a resource
server.resource(
  "greeting",
  "greeting://hello",
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: "This is a greeting resource from the MCP server!"
      }
    ]
  })
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Hello MCP Server running on stdio");
```

### Example 2: File System Server (Practical)

```typescript
// src/file-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "fs/promises";
import * as path from "path";

const server = new McpServer({
  name: "filesystem",
  version: "1.0.0"
});

// Tool: Read a file
server.tool(
  "read_file",
  "Read the contents of a file",
  {
    path: { type: "string", description: "File path to read" }
  },
  async ({ path: filePath }) => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return {
        content: [{ type: "text", text: content }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }]
      };
    }
  }
);

// Tool: Write a file
server.tool(
  "write_file",
  "Write content to a file",
  {
    path: { type: "string", description: "File path to write" },
    content: { type: "string", description: "Content to write" }
  },
  async ({ path: filePath, content }) => {
    try {
      await fs.writeFile(filePath, content, "utf-8");
      return {
        content: [{ type: "text", text: `Successfully wrote to ${filePath}` }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }]
      };
    }
  }
);

// Tool: List directory
server.tool(
  "list_directory",
  "List files in a directory",
  {
    path: { type: "string", description: "Directory path" }
  },
  async ({ path: dirPath }) => {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      const items = entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file"
      }));
      return {
        content: [{
          type: "text",
          text: JSON.stringify(items, null, 2)
        }]
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${error.message}` }]
      };
    }
  }
);

// Resource: Project info
server.resource(
  "project_info",
  "project://info",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({
        name: "My Project",
        version: "1.0.0",
        description: "A sample project"
      }, null, 2)
    }]
  })
);

// Prompt: Code review
server.prompt(
  "review_code",
  "Review code for potential issues",
  [
    { name: "code", description: "Code to review", required: true }
  ],
  async ({ code }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please review the following code for potential issues, bugs, and improvements:\n\n\`\`\`\n${code}\n\`\`\``
        }
      }
    ]
  })
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("File System MCP Server running on stdio");
```

### Example 3: Database Server with Zod Validation

```typescript
// src/database-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Simulated database
const users = [
  { id: 1, name: "Alice", email: "alice@example.com" },
  { id: 2, name: "Bob", email: "bob@example.com" },
  { id: 3, name: "Charlie", email: "charlie@example.com" }
];

const server = new McpServer({
  name: "database",
  version: "1.0.0"
});

// Tool: Search users with Zod schema
server.tool(
  "search_users",
  "Search for users in the database",
  {
    query: z.string().describe("Search query (name or email)"),
    limit: z.number().optional().describe("Max results to return")
  },
  async ({ query, limit = 10 }) => {
    const results = users.filter(
      (u) =>
        u.name.toLowerCase().includes(query.toLowerCase()) ||
        u.email.toLowerCase().includes(query.toLowerCase())
    ).slice(0, limit);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(results, null, 2)
      }]
    };
  }
);

// Tool: Get user by ID
server.tool(
  "get_user",
  "Get a user by their ID",
  {
    id: z.number().describe("User ID")
  },
  async ({ id }) => {
    const user = users.find((u) => u.id === id);
    if (!user) {
      return {
        isError: true,
        content: [{ type: "text", text: `User with ID ${id} not found` }]
      };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify(user, null, 2)
      }]
    };
  }
);

// Tool: Create user
server.tool(
  "create_user",
  "Create a new user",
  {
    name: z.string().describe("User name"),
    email: z.string().email().describe("User email")
  },
  async ({ name, email }) => {
    const newUser = {
      id: users.length + 1,
      name,
      email
    };
    users.push(newUser);
    return {
      content: [{
        type: "text",
        text: `Created user: ${JSON.stringify(newUser)}`
      }]
    };
  }
);

// Resource: Database schema
server.resource(
  "db_schema",
  "database://schema",
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({
        users: {
          columns: ["id (INTEGER)", "name (TEXT)", "email (TEXT)"]
        }
      }, null, 2)
    }]
  })
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Database MCP Server running on stdio");
```

---

## Building an MCP Client

### Basic Client

```typescript
// src/client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Create client
const client = new Client({
  name: "my-client",
  version: "1.0.0"
});

// Create transport (connects to server process)
const transport = new StdioClientTransport({
  command: "node",
  args: ["./dist/server.js"]
});

// Connect to server
await client.connect(transport);

// List available tools
const tools = await client.listTools();
console.log("Available tools:", tools);

// Call a tool
const result = await client.callTool({
  name: "greet",
  arguments: { name: "World" }
});
console.log("Result:", result);

// List resources
const resources = await client.listResources();
console.log("Available resources:", resources);

// Read a resource
const resource = await client.readResource({
  uri: "greeting://hello"
});
console.log("Resource:", resource);

// Disconnect
await client.close();
```

### Client with Error Handling

```typescript
// src/robust-client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

class McpClientWrapper {
  private client: Client;
  private transport: StdioClientTransport | null = null;

  constructor(private serverPath: string) {
    this.client = new Client({
      name: "robust-client",
      version: "1.0.0"
    });
  }

  async connect() {
    try {
      this.transport = new StdioClientTransport({
        command: "node",
        args: [this.serverPath]
      });
      await this.client.connect(this.transport);
      console.log("Connected to MCP server");
    } catch (error) {
      console.error("Failed to connect:", error);
      throw error;
    }
  }

  async callTool(name: string, args: Record<string, unknown>) {
    try {
      const result = await this.client.callTool({ name, arguments: args });
      if (result.isError) {
        console.error("Tool error:", result.content);
        throw new Error(`Tool ${name} failed`);
      }
      return result.content;
    } catch (error) {
      console.error(`Error calling ${name}:`, error);
      throw error;
    }
  }

  async disconnect() {
    if (this.transport) {
      await this.client.close();
    }
  }
}

// Usage
const client = new McpClientWrapper("./dist/server.js");
await client.connect();
const result = await client.callTool("greet", { name: "World" });
await client.disconnect();
```

---

## Real-World Examples

### Example 1: GitHub MCP Server

```typescript
// Simplified GitHub MCP Server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({
  name: "github",
  version: "1.0.0"
});

// Tool: Get repository info
server.tool(
  "get_repo",
  "Get information about a GitHub repository",
  {
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name")
  },
  async ({ owner, repo }) => {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`
    );
    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
  }
);

// Tool: Search issues
server.tool(
  "search_issues",
  "Search issues in a repository",
  {
    owner: z.string(),
    repo: z.string(),
    query: z.string().describe("Search query")
  },
  async ({ owner, repo, query }) => {
    const response = await fetch(
      `https://api.github.com/search/issues?q=${query}+repo:${owner}/${repo}`
    );
    const data = await response.json();
    return {
      content: [{ type: "text", text: JSON.stringify(data.items, null, 2) }]
    };
  }
);
```

### Example 2: Slack MCP Server

```typescript
// Simplified Slack MCP Server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const server = new McpServer({
  name: "slack",
  version: "1.0.0"
});

// Tool: Send message
server.tool(
  "send_message",
  "Send a message to a Slack channel",
  {
    channel: z.string().describe("Channel name or ID"),
    text: z.string().describe("Message text")
  },
  async ({ channel, text }) => {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ channel, text })
    });
    const data = await response.json();
    return {
      content: [{
        type: "text",
        text: data.ok ? "Message sent!" : `Error: ${data.error}`
      }]
    };
  }
);

// Tool: Get channel history
server.tool(
  "get_history",
  "Get message history from a channel",
  {
    channel: z.string().describe("Channel name or ID"),
    limit: z.number().optional().describe("Number of messages to fetch")
  },
  async ({ channel, limit = 10 }) => {
    const response = await fetch(
      `https://slack.com/api/conversations.history?channel=${channel}&limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${process.env.SLACK_TOKEN}` }
      }
    );
    const data = await response.json();
    return {
      content: [{
        type: "text",
        text: JSON.stringify(data.messages, null, 2)
      }]
    };
  }
);
```

---

## Advanced Topics

### 1. Server Capabilities

When a server starts, it advertises what it can do:

```typescript
const server = new McpServer({
  name: "advanced-server",
  version: "1.0.0"
});

// Server automatically announces capabilities during initialization
// Client can query: server.capabilities.tools, server.capabilities.resources, etc.
```

### 2. Sampling (Server → Client LLM Calls)

Sometimes the server needs the AI to process something:

```typescript
server.tool(
  "analyze_code",
  "Use AI to analyze code quality",
  {
    code: z.string()
  },
  async ({ code }) => {
    // Ask the client's LLM to analyze the code
    const result = await server.server.request({
      method: "sampling/createMessage",
      params: {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `Analyze this code for quality issues:\n${code}`
          }
        }]
      }
    });
    return {
      content: [{ type: "text", text: result.content.text }]
    };
  }
);
```

### 3. Logging

```typescript
import { SetLevelRequestSchema } from "@modelcontextprotocol/sdk/types.js";

// Server can send log messages to the client
server.server.sendLoggingMessage({
  level: "info",
  data: "Processing request..."
});

server.server.sendLoggingMessage({
  level: "error",
  data: "Something went wrong!"
});
```

### 4. Progress Reporting

```typescript
server.tool(
  "long_running_task",
  "A task that takes time",
  {},
  async (args, extra) => {
    // Report progress
    extra?.sendProgress?.({ progress: 0, total: 100 });
    await doStep1();
    extra?.sendProgress?.({ progress: 33, total: 100 });
    await doStep2();
    extra?.sendProgress?.({ progress: 66, total: 100 });
    await doStep3();
    extra?.sendProgress?.({ progress: 100, total: 100 });

    return { content: [{ type: "text", text: "Done!" }] };
  }
);
```

### 5. Multiple Transports

```typescript
// Run server on both stdio and HTTP
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "multi-transport",
  version: "1.0.0"
});

// For CLI/IDE usage
const stdioTransport = new StdioServerTransport();
await server.connect(stdioTransport);

// For web usage (HTTP+SSE)
// const httpTransport = new SSEServerTransport("/sse");
// await server.connect(httpTransport);
```

---

## Best Practices

### 1. Tool Design

```typescript
// ✅ Good: Clear, specific tool with good description
server.tool(
  "search_files",
  "Search for files by name pattern in a directory. Returns matching file paths.",
  {
    directory: z.string().describe("Directory to search in"),
    pattern: z.string().describe("Glob pattern (e.g., '*.ts', '**/*.md')")
  },
  async ({ directory, pattern }) => { /* ... */ }
);

// ❌ Bad: Vague tool with no description
server.tool(
  "do_stuff",
  "Does things",
  { input: z.any() },
  async ({ input }) => { /* ... */ }
);
```

### 2. Error Handling

```typescript
server.tool(
  "risky_operation",
  "Performs a risky operation",
  { data: z.string() },
  async ({ data }) => {
    try {
      const result = await performOperation(data);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }]
      };
    } catch (error) {
      // Return structured error, don't throw
      return {
        isError: true,
        content: [{
          type: "text",
          text: `Operation failed: ${error.message}\nSuggestion: Check your input data.`
        }]
      };
    }
  }
);
```

### 3. Resource Naming

```
✅ Good resource URIs:
  file:///path/to/file.txt
  db://table/row
  api://endpoint
  config://app/settings

❌ Bad resource URIs:
  /path/to/file.txt
  mydata
  stuff
```

### 4. Security Considerations

```typescript
// Never expose sensitive data without proper auth
server.tool(
  "get_secret",
  "Get a secret value (requires authentication)",
  { key: z.string() },
  async ({ key }) => {
    // Validate the key exists and user has access
    if (!isValidKey(key)) {
      return {
        isError: true,
        content: [{ type: "text", text: "Unauthorized" }]
      };
    }
    // ...
  }
);
```

### 5. Documentation

```typescript
// Use descriptions everywhere
server.tool(
  "calculate",
  "Perform mathematical calculations. Supports: +, -, *, /, ** (power), sqrt, log.",
  {
    expression: z.string().describe(
      "Mathematical expression to evaluate. Examples: '2 + 2', 'sqrt(16)', '2 ** 10'"
    )
  },
  async ({ expression }) => { /* ... */ }
);
```

---

## Quick Reference

### MCP Server Checklist

```
□ Initialize server with name and version
□ Register tools (what the AI can do)
□ Register resources (what data is available)
□ Register prompts (what templates exist)
□ Connect to transport (stdio, HTTP, or WebSocket)
□ Handle errors gracefully
□ Add descriptions to everything
□ Test with MCP Inspector
```

### Useful Commands

```bash
# Run your MCP server
node dist/server.js

# Debug with MCP Inspector
npx @modelcontextprotocol/inspector node dist/server.js

# Install MCP server in Claude Desktop
# Edit ~/Library/Application Support/Claude/claude_desktop_config.json
```

### Claude Desktop Config Example

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/my-server/dist/index.js"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}
```

---

## Summary

| Concept | What | Who Controls | Use Case |
|---------|------|--------------|----------|
| **Tools** | Functions the AI calls | AI decides | Database queries, API calls, file ops |
| **Resources** | Data exposed to AI | App decides | Config, files, schemas |
| **Prompts** | Reusable templates | User decides | Code review, debugging |
| **Sampling** | AI calls back to LLM | Server decides | Code analysis, summarization |

### The Flow

1. **Server** starts and connects via transport
2. **Client** discovers available tools/resources/prompts
3. **User** asks a question
4. **AI** decides which tool to use (or reads a resource)
5. **Client** sends the request to the server
6. **Server** executes the tool and returns results
7. **AI** uses the results to answer the user

---

## Resources

- [MCP Specification](https://spec.modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)

---

*This guide covers MCP from basics to advanced topics. Start with the Hello World example and build up to more complex servers as you understand the protocol better.*
