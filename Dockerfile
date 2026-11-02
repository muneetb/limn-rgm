FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production TZ=America/Chicago
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
USER node
EXPOSE 8080
# The web service. The scheduled agent job overrides the command with: node src/job.js
CMD ["node", "src/server.js"]
