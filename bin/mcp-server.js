#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "omnichat-harness",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "omnichat_status",
        description: "Get the current health and connection status of the OmniChat multi-provider gateway",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "omnichat_list_providers",
        description: "List all supported web AI providers and their session status in OmniChat",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "omnichat_dispatch_prompt",
        description: "Dispatch an agent completion request through OmniChat's dual OpenAI/Anthropic gateway",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Prompt text to evaluate" },
            provider: { type: "string", description: "Target provider (chatgpt, claude, gemini, perplexity)", default: "claude" },
          },
          required: ["prompt"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "omnichat_status") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "online",
            gateway: "http://127.0.0.1:3000",
            protocols: ["openai", "anthropic"],
            uptime: process.uptime(),
          }, null, 2),
        },
      ],
    };
  }

  if (name === "omnichat_list_providers") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            providers: [
              { id: "claude", name: "Anthropic Claude", protocol: "anthropic", supported: true },
              { id: "chatgpt", name: "OpenAI ChatGPT", protocol: "openai", supported: true },
              { id: "gemini", name: "Google Gemini", protocol: "openai-adapter", supported: true },
              { id: "perplexity", name: "Perplexity AI", protocol: "openai-adapter", supported: true },
            ],
          }, null, 2),
        },
      ],
    };
  }

  if (name === "omnichat_dispatch_prompt") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            dispatched: true,
            provider: args?.provider || "claude",
            message: "Prompt accepted by OmniChat gateway dispatcher.",
          }, null, 2),
        },
      ],
    };
  }

  throw new Error(`Tool ${name} not found`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
