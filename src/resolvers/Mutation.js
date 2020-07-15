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
    }
};

module.exports = mutations;
