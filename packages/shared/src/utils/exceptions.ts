import { HttpStatusCode } from "../constants";

export const isHttpStatus = (status: number): status is HttpStatusCode =>
  Object.values<number>(HttpStatusCode).includes(status);

interface HttpExceptionOptions {
  message?: string;
  code?: string;
}

export class HttpException extends Error {
  readonly status?: HttpStatusCode;
  readonly code?: string;

  constructor(status?: HttpStatusCode, options?: HttpExceptionOptions) {
    super(options?.message);
    this.status = status;
    this.code = options?.code;
  }
}

export const getStatusCode = (e: unknown) => {
  if (typeof e === "object" && e && "status" in e) {
    const status = Number(e.status);
    // Guard against NaN or invalid status codes
    if (!Number.isNaN(status) && status >= 200 && status <= 599) {
      return status;
    }
  }

  return HttpStatusCode.INTERNAL_SERVER_ERROR;
};
