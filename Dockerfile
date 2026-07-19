FROM node:20-alpine AS builder
WORKDIR /build/nextjs
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_CLIENT_SLUG
COPY nextjs/package*.json ./
RUN npm install
COPY nextjs/ ./
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /build/nextjs/.next/standalone ./
COPY --from=builder /build/nextjs/.next/static ./.next/static
# /api/copy and /api/icp-filter read pipeline/config/*.json via
# join(process.cwd(), '../pipeline/config/...') — cwd is /app at runtime,
# so this must land at /pipeline/config, a sibling of /app.
COPY pipeline/config/ /pipeline/config/
EXPOSE 3000
CMD ["node", "server.js"]
