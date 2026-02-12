# Backend Dockerfile
# Single-stage build — tsx compiles TypeScript at runtime

# Production stage
FROM node:20-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Set working directory
WORKDIR /app

# Set node environment
ENV NODE_ENV=production
ENV PORT=3001

# Copy package files
COPY package*.json ./

# Install all dependencies (tsx needed at runtime for ESM resolution)
RUN npm ci && npm cache clean --force

# Copy source code (tsx runs TypeScript directly, no build step needed)
COPY src ./src
COPY tsconfig.json ./

# Create logs directory
RUN mkdir -p logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health/live', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application using tsx (handles ESM imports without .js extensions)
CMD ["./node_modules/.bin/tsx", "src/server.ts"]
