import Stripe from "stripe";

import { env } from "./env";

let stripeInstance: Stripe | null = null;

export const stripe = () => {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is required when using Stripe billing");
  }
  stripeInstance ??= new Stripe(key);

  return stripeInstance;
};
