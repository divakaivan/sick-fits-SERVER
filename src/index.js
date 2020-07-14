require('dotenv').config({path: "variables.env"});
const createServer = require('./createServer'); // dont install as dep
const db = require('./db');

const server = createServer();

// TODO use express middleware to handle cookies(JWT) and populate current user

server.start({
    cors: {
        credentials: true,
        origin: process.env.FRONTEND_URL
    }
}, deets => {
    console.log(`Server RUNNING on http://localhost:${deets.port}/`);
});