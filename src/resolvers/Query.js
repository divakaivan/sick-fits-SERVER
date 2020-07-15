const {forwardTo} = require('prisma-binding');

const Query = {
    items: forwardTo('db'),
    // this is the same as below. It is because we directly just wanted items, there is nothing extra happening
    // async items(parent, args, ctx, info) {
    //     const items = await ctx.db.query.items();
    //     return items;
    // }
    item: forwardTo('db'),

};

module.exports = Query;
