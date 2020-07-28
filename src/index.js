const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config({path: "variables.env"});
const createServer = require('./createServer'); // dont install as dep
const db = require('./db');

const server = createServer();

// use express middleware to handle cookies(JWT) and populate current user
server.express.use(cookieParser());

// decode the jwt so we can get the user id on each request
server.express.use((req, res, next)=> {
   const {token} = req.cookies;
   if (token) {
       const {userId} = jwt.verify(token, process.env.APP_SECRET);
       // put the userId onto the request for further request to access
       req.userId = userId;
   }
   next()
});

server.start({
    cors: {
        credentials: true,
        origin: process.env.FRONTEND_URL
    }
}, deets => {
    console.log(`Server RUNNING on http://localhost:${deets.port}/`);
});