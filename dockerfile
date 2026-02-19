# Use Node 20 (latest LTS) to satisfy AWS SDK requirements
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install build tools (needed for some npm packages)
RUN apk add --no-cache python3 make g++

# Copy package.json and package-lock.json first
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all source files
COPY . .

# Expose the port your Express app listens on
EXPOSE 3000

# Start the app
CMD ["node", "index.js"]
