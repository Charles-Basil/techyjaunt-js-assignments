FROM node:22-alpine

WORKDIR /app

# Install dependencies first (cached unless package*.json changes).
# bcrypt is a native module, so we temporarily add build tools in case no
# prebuilt binary matches Alpine, then remove them to keep the image small.
COPY package.json package-lock.json ./
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
    && npm ci --omit=dev \
    && apk del .build-deps

# Copy the source code.
COPY . .

# Don't run as root inside the container.
USER node

EXPOSE 3000

# Run migrations, then replace the shell with node (exec) so node receives
# SIGTERM from `docker stop` and can shut down gracefully.
CMD ["sh", "-c", "npx knex migrate:latest && exec node src/server.js"]
