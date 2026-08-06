# Stage 1: Build Vite React PWA App
FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Serve via Nginx with SSL support
FROM nginx:alpine

# Install openssl for certificate generation fallback
RUN apk add --no-cache openssl

# Copy built frontend static files
COPY --from=build /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration with SSL and proxy support
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Pre-generate self-signed SSL certs with SAN in case none are mounted
RUN mkdir -p /etc/nginx/certs && \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/certs/key.pem \
    -out /etc/nginx/certs/cert.pem \
    -subj "/CN=SNIST-QR-Attendance/O=SNIST" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
