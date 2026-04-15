export class InviteExpiredError extends Error {
  constructor(code: string) {
    super(`Invite "${code}" has expired`);
    this.name = "InviteExpiredError";
  }
}

export class InviteNotFoundError extends Error {
  constructor(code: string) {
    super(`Invite "${code}" not found`);
    this.name = "InviteNotFoundError";
  }
}
