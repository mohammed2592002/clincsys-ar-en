# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package manifests
COPY package*.json ./

# Install dependencies (including devDependencies for build)
RUN npm install

# Copy project files
COPY . .

# Run build script (vite build + esbuild server.ts)
RUN npm run build

# Stage 2: Production runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package manifests and install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend assets and bundled backend server
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server

# Ensure uploads directory exists
RUN mkdir -p /app/uploads

EXPOSE 3000

CMD ["node", "dist-server/server.cjs"]
