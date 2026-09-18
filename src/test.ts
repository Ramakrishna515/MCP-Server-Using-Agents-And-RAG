import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = new URL("./server.js", import.meta.url).pathname;

const client = new Client({ name: "test-client", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
});

await client.connect(transport);
console.log("Connected. Listing tools...");

const { tools } = await client.listTools();
console.log("Tools:", tools.map((t) => `${t.name} (${t.description})`));

console.log("\nAdding a note...");
const added = await client.callTool({
  name: "add_note",
  arguments: { title: "Shopping", content: "Milk, eggs, bread" },
});
console.log("add_note ->", (added.content as { text: string }[])?.[0]);

console.log("\nAdding another note...");
await client.callTool({
  name: "add_note",
  arguments: { title: "Meeting", content: "Team standup at 10am" },
});

console.log("\nListing notes...");
const listed = await client.callTool({ name: "list_notes", arguments: {} });
console.log("list_notes ->", (listed.content as { text: string }[])[0].text);

await client.close();
console.log("\nTest passed.");
