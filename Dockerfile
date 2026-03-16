# Base image
FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Install tsx globally or locally to run TypeScript files
RUN npm install tsx -g

# Bundle app source
COPY . .

# Expose the correct port
# Cloud Run automatically sets the PORT environment variable.
EXPOSE 8080

# Command to run the backend server
CMD [ "tsx", "server.ts" ]
