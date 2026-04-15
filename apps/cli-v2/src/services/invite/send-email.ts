// Email delivery is handled server-side when email is passed to generateInvite.
// This file exists for the spec's completeness.
export async function sendInviteEmail(_email: string, _inviteUrl: string): Promise<void> {
  // No-op: backend sends the email when invite is created with an email parameter
}
