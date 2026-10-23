FROM node:20-alpine

WORKDIR /app

# Install TypeScript and build tools
RUN npm install -g typescript ts-node

# Copy package files
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

# Copy source
COPY backend/src ./src
COPY backend/scripts ./scripts
COPY shared/src ./shared/src
COPY shared/package.json ./shared/package.json

# Build
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
