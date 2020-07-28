const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const mutations = {
    async createItem(parent, args, ctx, info) {
        // TODO: check if they are logged in
        const item = await ctx.db.mutation.createItem(
            {
                data: {
                    ...args
                }
            }, info);
        return item
    },
    updateItem(parent, args, ctx, info) {
        // first take a copy of the updates
        const updates = {...args};
        // remove the id from the updates, because it will get passed in, but we dont want to update it
        delete updates.id;
        // run the update method that comes from prisma.graphql
        return ctx.db.mutation.updateItem({
            data: updates,
            where: {
                id: args.id
            }
        }, info)
    },
    async deleteItem(parent, args, ctx, info) {
        const where = {id: args.id};
        // 1.find the item
        const item = await ctx.db.query.item({where}, `{id, title}`)
        // 2. check if they own that item or have the permissions
        // TODO
        // 3. delete it!
        return ctx.db.mutation.deleteItem({where}, info);
    },
    async signup(parent, args, ctx, info) {
        args.email = args.email.toLowerCase();
        // hash the password || bcrypt is async thats why we need await
        const password = await bcrypt.hash(args.password, 10);
        // create the user in the db
        const user = await ctx.db.mutation.createUser({
            data: {
                ...args, // same as name: args.name, email: args.email, password: args.password
                password,
                permissions: { set: ['USER'] }
            }
        }, info);
        // create jwt token for the user
        const token = jwt.sign({userId: user.id}, process.env.APP_SECRET);
        // set the jwt as a cookie on the response so that every time they click on another page, the token comes on the ride
        ctx.response.cookie('token', token, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365 // 1 year cookie
        });
        // finally return the user to the browser
        return user;
    },
    async signin(parent, {email, password}, ctx, info) {
        // 1. check if there is a user with that email
        const user = await ctx.db.query.user({where: {email}});
        if (!user) {
            throw new Error(`No such user found for email: ${email}`) // this error is thrown to the frontend and is caught by Query/Mutation components
        };
        // 2. check if their password is correct
        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            throw new Error('Invalid password!')
        }
        // 3. generate the jwt token
        const token = jwt.sign({userId: user.id}, process.env.APP_SECRET);
        // 4. set the cookie with the token
        ctx.response.cookie('token', token, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365
        });
        // 5. return the user
        return user;
    },
    signout(parent, args, ctx, info) {
        ctx.response.clearCookie('token'); // we can use clearCookie here because in index.js the cookieParser is used as middleware
        return {message: 'Goodbye!'};
    }
};

module.exports = mutations;
