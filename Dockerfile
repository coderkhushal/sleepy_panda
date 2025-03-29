# Dockerfile for Node.js application

# Use an official Node.js runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy app source code to the working directory
COPY . .

# Expose the port your app runs on
EXPOSE 8000

# Run the app
CMD [ "node", "index.js" ]