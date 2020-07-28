const {forwardTo} = require('prisma-binding');

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
    }
};

module.exports = Query;
