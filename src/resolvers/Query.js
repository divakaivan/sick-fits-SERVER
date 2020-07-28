const {forwardTo} = require('prisma-binding');
const {hasPermission} = require("../utils");

const Query = {
    items: forwardTo('db'),
    // this is the same as below. It is because we directly just wanted items, there is nothing extra happening
    // async items(parent, args, ctx, info) {
    //     const items = await ctx.db.query.items();
    //     return items;
    // }
    item: forwardTo('db'),
    itemsConnection: forwardTo('db'),
    me(parent, args, ctx, info) {
        // check if there is a current userId
        if (!ctx.request.userId) { // we should have put a userId in the request from the middleware in index.js
            return null
        }
        return ctx.db.query.user({
            where: {id: ctx.request.userId}
        }, info)
    },
    async users(parent, args, ctx, info) {
        // 1. check if user is logged in
        if (!ctx.request.userId) {
            throw new Error('You must be logged in!')
        }
        // 2. check if the user has the permissions to query all the users
        hasPermission(ctx.request.user, ['ADMIN', 'PERMISSIONUPDATE']);
        // 3. if they do, query all the users
        return ctx.db.query.users({}, info) // pass empty where object since we want all users.
    }
};

module.exports = Query;
