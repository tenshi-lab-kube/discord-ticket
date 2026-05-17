const ticketHandler = require('../handlers/ticket');

module.exports = {
  name: 'guildMemberAdd',
  async execute(member) {
    await ticketHandler.notifyTicketOwnerReturned(member).catch(console.error);
  },
};
