FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install @modelcontextprotocol/sdk --omit=dev

COPY bin/mcp-server.js ./bin/mcp-server.js

ENTRYPOINT ["node", "bin/mcp-server.js"]
