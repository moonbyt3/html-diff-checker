# Use the Node.js official image as the base
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the entire application code into the container
COPY . .

# Expose the port your app runs on
EXPOSE 8042

# Command to start your application
CMD ["npm", "start"]