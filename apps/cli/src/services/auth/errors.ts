export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class DeviceCodeExpired extends AuthError {
  constructor() {
    super("Device code expired. Run `claudemesh login` again.");
  }
}

export class NotSignedIn extends AuthError {
  constructor() {
    super("Not signed in. Run `claudemesh login` first.");
  }
}
