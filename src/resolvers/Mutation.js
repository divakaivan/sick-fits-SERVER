const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {randomBytes} = require('crypto');
const {promisify} = require('util'); // this takes callback based funcs and makes them promise based
const {transport, makeANiceEmail} = require('../mail');
const {hasPermission} = require("../utils");
const stripe = require('../stripe');

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
        const hasPermissions = ctx.request.user.permissions.some(permission => ['ADMIN', 'ITEMDELETE'].includes(permission)); // this checks if the user has either one(at least one) of the ADMIN or ITEMDELETE
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
                permissions: {set: ['USER']}
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
        }
        ;
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
        if (args.password !== args.confirmPassword) {
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
    },
    async addToCart(parent, args, ctx, info) {
        // 1. make sure user is signed in
        const userId = ctx.request.userId;
        if (!userId) throw new Error("You must be signed in!");
        // 2. query the user's current cart
        const [existingCartItem] = await ctx.db.query.cartItems({
            where: {
                user: {id: userId},
                item: {id: args.id}
            }
        }, info);
        // 3. check if that item is already in their cart and increment by 1 if so
        if (existingCartItem) {
            console.log("This item is already in their cart");
            return ctx.db.mutation.updateCartItem({
                where: {id: existingCartItem.id},
                data: {quantity: existingCartItem.quantity + 1}
            }, info)
        }
        // 4. if its not, create a fresh cartItem for that user
        return ctx.db.mutation.createCartItem({
            data: {
                user: {
                    connect: {id: userId}
                },
                item: {
                    connect: {id: args.id} // prisma way of relationships
                }
            }
        }, info)
    },
    async removeFromCart(parent, args, ctx, info) {
        // 1. find the cart item
        const cartItem = await ctx.db.query.cartItem({
            where: {id: args.id}
        }, `{id, user {id}}`);
        // 1.5 make sure an item is found
        if (!cartItem) throw new Error("No cart item found!")
        // 2. make sure they own the cart item
        if (cartItem.user.id !== ctx.request.userId) throw new Error("You are not the owner of this cart!")
        // 3. delete that cart item
        return ctx.db.mutation.deleteCartItem({where: {id: args.id}}, info)
    },
    async createOrder(parent, args, ctx, info) {
        // 1. query the current user and make sure they are signed in
        const {userId} = ctx.request;
        if (!userId) throw new Error('You must be signed in to complete this order.');
        const user = await ctx.db.query.user(
            {where: {id: userId}},
            `{
                  id
                  name
                  email
                  cart {
                    id
                    quantity
                    item { title price id description image largeImage }
                  }}`
        );
        // 2. recalculate the total for the price
        const amount = user.cart.reduce(
            (tally, cartItem) => tally + cartItem.item.price * cartItem.quantity,
            0
        );
        // 3. create the stripe charge (turn token into money)
        const charge = await stripe.charges.create({
            amount,
            currency: "USD",
            source: args.token
        });
        // 4. convert the cart items to order items
        const orderItems = user.cart.map(cartItem=>{
           const orderItem = {
               ...cartItem.item,
               quantity: cartItem.quantity,
               user: {connect: {id: userId}},
           }; // takes a copy of all the fields, add the quantity, connect the user
           delete orderItem.id;
           return orderItem
        });
        // 5. create the order
        const order = await ctx.db.mutation.createOrder({
            data: {
                total: charge.amount,
                charge: charge.id,
                items: {create: orderItems},
                user: {connect: {id: userId}}
            }
        });
        // 6. clean up - clear the user's cart, delete the cartItems
        const cartItemIds = user.cart.map(cartItem=>cartItem.id);
        await ctx.db.mutation.deleteManyCartItems({
            where: {id_in: cartItemIds}
        }); // comes from prisma :O
        // 7. return the order to the client
        return order;
    }
};

module.exports = mutations;
