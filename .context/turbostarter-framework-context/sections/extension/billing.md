---
title: Billing
description: Get started with billing in TurboStarter.
url: /docs/extension/billing
---

# Billing

As you could guess, there is no sense in implementing the whole billing process inside the browser extension, so we're relying on the [web app](/docs/web/billing/overview) to handle it.

> You probably won't display pricing tables inside a popup window, right?

You can customize the whole flow and onboarding process when a user purchases a plan in your [web app](/docs/web/billing/overview).

Then you would be able to easily fetch customer data to ensure that the user has access to correct extension features.

## Fetching customer data

When your user has purchased a plan from your landing page or web app, you can easily fetch their data using the [API](/docs/extension/api/client).

To do so, just invoke the `getCustomer` query on the `billing` router:

```tsx title="customer-screen.tsx"
import { api } from "~/lib/api";

export default function CustomerScreen() {
  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer"],
    queryFn: handle(api.billing.customer.$get),
  });

  if (isLoading) return <p>Loading...</p>;

  return <p>{customer?.plan}</p>;
}
```

You may also want to ensure that user is logged in before fetching their billing data to avoid unnecessary API calls.

```tsx title="header.tsx"
import { api } from "~/lib/api";
import { authClient } from "~/lib/auth";

export const User = () => {
  const {
    data: { user },
  } = authClient.useSession();

  const { data: customer } = useQuery({
    queryKey: ["customer"],
    queryFn: handle(api.billing.customer.$get),
    enabled: !!user, // [!code highlight]
  });

  if (!user || !customer) {
    return null;
  }

  return (
    <div>
      <p>{user.email}</p>
      <p>{customer.plan}</p>
    </div>
  );
};
```

Read more about [auth in extension](/docs/extension/auth/overview).
