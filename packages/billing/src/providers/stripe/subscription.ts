import { HttpStatusCode } from "@turbostarter/shared/constants";
import { logger } from "@turbostarter/shared/logger";
import { HttpException } from "@turbostarter/shared/utils";

import { config } from "../../config";
import { getCustomerByCustomerId, updateCustomer } from "../../lib/customer";

import { stripe } from "./client";
import { toBillingStatus } from "./mappers/to-billing-status";

import type Stripe from "stripe";

const getSubscription = async (subscriptionId: string) => {
  return stripe().subscriptions.retrieve(subscriptionId) as Promise<
    Stripe.Response<Stripe.Subscription & { plan: Stripe.Plan }>
  >;
};

export const getPromotionCode = async (code: string) => {
  try {
    const { data } = await stripe().promotionCodes.list({
      code,
    });

    return data[0];
  } catch (e) {
    logger.error(e);
    throw new HttpException(HttpStatusCode.INTERNAL_SERVER_ERROR, {
      code: "billing:error.promotionCodeRetrieve",
    });
  }
};

export const subscriptionStatusChangeHandler = async ({
  id,
  customerId,
}: {
  id: string;
  customerId: string;
}) => {
  const customer = await getCustomerByCustomerId(customerId);

  if (!customer) {
    throw new HttpException(HttpStatusCode.NOT_FOUND, {
      code: "billing:error.customerNotFound",
    });
  }

  const subscription = await getSubscription(id);

  const priceId = subscription.plan.id;
  const plan = config.plans.find((p) => p.prices.find((x) => x.id === priceId));

  await updateCustomer(customer.userId, {
    status: toBillingStatus(subscription.status),
    ...(plan && { plan: plan.id }),
  });

  logger.info(
    `✅ Subscription status changed for user ${customer.userId} to ${subscription.status}`,
  );
};
