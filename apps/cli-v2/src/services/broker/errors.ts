export class BrokerConnectionError extends Error {
  constructor(message: string, public readonly url: string) {
    super(message);
    this.name = "BrokerConnectionError";
  }
}

export class HelloAckTimeout extends Error {
  constructor() {
    super("hello_ack timeout — broker did not respond");
    this.name = "HelloAckTimeout";
  }
}
