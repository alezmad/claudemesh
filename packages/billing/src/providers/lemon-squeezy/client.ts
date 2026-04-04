import { lemonSqueezySetup } from "@lemonsqueezy/lemonsqueezy.js";

import { HttpStatusCode } from "@turbostarter/shared/constants";
import { logger } from "@turbostarter/shared/logger";
import { HttpException } from "@turbostarter/shared/utils";

import { env } from "./env";

export const setup = () => {
  return lemonSqueezySetup({
    apiKey: env.LEMON_SQUEEZY_API_KEY,
    onError: (error) => {
      logger.error(error);
      throw new HttpException(HttpStatusCode.INTERNAL_SERVER_ERROR, {
        code: "billing:error.lemonSqueezy",
        message: error.message,
      });
    },
  });
};
