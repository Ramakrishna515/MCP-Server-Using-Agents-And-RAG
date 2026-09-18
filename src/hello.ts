import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "hello-server",
  version: "1.0.0",
});

server.tool(
  "greet",
  "Greet someone by name",
  { name: z.string().describe("Name of the person") },
  async ({ name }) => ({
    content: [{ type: "text", text: `Hello, ${name}! 👋` }],
  })
);

server.resource(
  "greeting",
  "greeting://hello",
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/plain", text: "Hi from the resource!" }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Hello Server running on stdio");
