# ==========================================================
# Multi-Stage Dockerfile for SNIST QR Attendance System
# Packages both Vite React PWA Frontend and FastAPI Backend
# ==========================================================

# ----------------------------------------------------------
# Stage 1: Build Frontend PWA Static Assets
# ----------------------------------------------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Copy package manifests and install dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy frontend source and build production bundle
COPY frontend/ ./
RUN npm run build

# ----------------------------------------------------------
# Stage 2: Python Backend Runtime & Unified Server
# ----------------------------------------------------------
FROM python:3.11-slim AS runtime

WORKDIR /app

# Install system runtime & compilation dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application source code
COPY backend/ .

# Copy compiled frontend distribution from Stage 1
COPY --from=frontend-builder /frontend/dist /app/frontend_dist

# Create required runtime storage folders
RUN mkdir -p /app/data/master_templates /app/data/outputs /app/data/qr_codes

# Configure environment variables
ENV PYTHONUNBUFFERED=1 \
    PORT=8000

EXPOSE 8000

# Container Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Start FastAPI Application
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
