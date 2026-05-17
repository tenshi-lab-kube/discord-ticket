const ticketHandler = require('../handlers/ticket');

module.exports = {
  name: 'guildMemberRemove',
  async execute(member) {
    await ticketHandler.notifyTicketOwnerLeft(member).catch(console.error);
  },
};
