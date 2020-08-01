const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {randomBytes} = require('crypto');
const {promisify} = require('util'); // this takes callback based funcs and makes them promise based
const {transport, makeANiceEmail} = require('../mail');
const {hasPermission} = require("../utils");


const mutations = {
    async createItem(parent, args, ctx, info) {
        if (!ctx.request.userId) {
            throw new Error('You must be logged in to do that!')
        }

        const item = await ctx.db.mutation.createItem(
            {
                data: {
                    ...args,
                    // this is how to create a relationship b/w item and user
                    user: {
                        connect: {
                            id: ctx.request.userId
                        }
                    }
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
        const item = await ctx.db.query.item({where}, `{id, title, user { id }}`);
        // 2. check if they own that item or have the permissions
        const ownsItem = item.user.id === ctx.request.userId;
        const hasPermissions = ctx.request.user.permissions.some(permission=>['ADMIN', 'ITEMDELETE'].includes(permission)); // this checks if the user has either one(at least one) of the ADMIN or ITEMDELETE
        if (!ownsItem && !hasPermissions) throw new Error('You don\'t have the permission for this action!');
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
    },

    async requestReset(parent, {email}, ctx, info) {
        // 1. check if this is a real user
        const user = await ctx.db.query.user({where: {email}});
        if (!user) {
            throw new Error(`No such user found for email: ${email}`)
        }
        // 2. set a reset token and expiry on that user
        const resetToken = (await promisify(randomBytes)(20)).toString('hex');
        const resetTokenExpiry = Date.now() + 3600000; // 1hour from now
        const res = await ctx.db.mutation.updateUser({
            where: {email},
            data: {resetToken, resetTokenExpiry}
        }, info);
        // 3. email them that reset token
        const mailRes = await transport.sendMail({
            from: "ivan@ivanov.com",
            to: user.email,
            subject: 'Your password reset token',
            html: makeANiceEmail(
                `Your password reset token is here! 
                    \n\n 
                    <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}"}>Click here to reset</a>`)
        });
        // 4. return success msg
        return {message: 'Thanks!'}
    },
    async resetPassword(parent, args, ctx, info) {
        // 1. check if the passwords match
        if(args.password !== args.confirmPassword) {
            throw new Error('Passwords do not match!')
        }
        // 2. check if its a legit resetToken
        // 3. check if its expired
        const [user] = await ctx.db.query.users({ // grab the first user
            where: {
                resetToken: args.resetToken,
                resetTokenExpiry_gte: Date.now() - 3600000
            }
        });
        if (!user) {
            throw new Error('This token is either invalid or expired!')
        }
        // 4. hash their new password
        const password = await bcrypt.hash(args.password, 10);
        // 5. save the new password to the user and remove old resetToken fields
        const updatedUser = await ctx.db.mutation.updateUser({
            where: {email: user.email},
            data: {password, resetToken: null, resetTokenExpiry: null}
        });
        // 6. generate jwt
        const token = jwt.sign({userId: updatedUser.id}, process.env.APP_SECRET)
        // 7. set the jwt cookie
        ctx.response.cookie('token', token, {
            httpOnly: true,
            maxAge: 1000 * 60 * 60 * 24 * 365
        });
        // 8. return the new user
        return updatedUser
    },

    async updatePermissions(parent, args, ctx, info) {
        // 1. check if they are logged in
        if (!ctx.request.userId) throw new Error("Must be logged in!")
        // 2. query the current user
        const currentUser = await ctx.db.query.user({
            where: {id: ctx.request.userId}
        }, info)
        // 3. check if they have permissions to do this
        hasPermission(currentUser, ['ADMIN', 'PERMISSIONUPDATE']);
        // 4. update the permissions
        return ctx.db.mutation.updateUser({
            data: {
                permissions: {
                    set: args.permissions
                }
            },
            where: {
                id: args.userId // not using our own userId because we might be updating someone else's permissions
            }
        }, info);
    }
};

module.exports = mutations;
