export async function runReminder(input = {}, ctx = {}) {
  const message = String(input?.message || '').trim();
  if (!message) throw new Error('reminder.input.message is required');

  const title = String(input?.title || 'Reminder').trim();
  const recipient = String(input?.recipient || 'agent-main').trim();

  return {
    summary: `⏰ ${title}: ${message}`,
    reminder: {
      title,
      message,
      recipient,
      sentAt: new Date().toISOString(),
    },
    context: ctx,
  };
}
