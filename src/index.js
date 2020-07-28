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

// create a middleware that populates the user on each request
server.express.use(async (req, res, next)=>{
    if (!req.userId) return next();
    const user = await db.query.user({where: {id: req.userId}}, '{id, permissions, email, name}')
    req.user = user;
    next();
});

server.start({
    cors: {
        credentials: true,
        origin: process.env.FRONTEND_URL
    }
}, deets => {
    console.log(`Server RUNNING on http://localhost:${deets.port}/`);
});