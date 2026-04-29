FROM node:22-alpine

WORKDIR /app

# Install backend deps
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Install frontend deps and build
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
RUN cd frontend && node node_modules/vite/bin/vite.js build

# Copy backend source
COPY backend/ ./backend/

# Copy root files
COPY package.json ./

EXPOSE 3001

CMD ["sh", "-c", "node backend/seed.js && node backend/server.js"]
