---
title: Billing
description: Get started with billing in TurboStarter.
url: /docs/mobile/billing
---

# Billing

<Callout title="Fully-featured billing on mobile is coming soon">
  For now, billing has a limited functionalities on mobile, we're mostly relying on the [web app](/docs/web/billing/overview) to handle billing.

  We are working on a fully-featured mobile billing to help you monetize your mobile app easier. Stay tuned for updates.

  [See roadmap](https://github.com/orgs/turbostarter/projects/1)
</Callout>

## Fetching customer data

When your user purchased a plan from your landing page or web app, you can easily fetch their data using the [API](/docs/mobile/api/client).

To do so, just call the `/api/billing/customer` endpoint:

```tsx title="customer-screen.tsx"
import { api } from "~/lib/api";

export default function CustomerScreen() {
  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer"],
    queryFn: handle(api.billing.customer.$get),
  });

  if (isLoading) return <Text>Loading...</Text>;

  return <Text>{customer?.plan}</Text>;
}
```

You may also want to ensure that user is logged in before fetching their billing data to avoid unnecessary API calls.

```tsx title="customer-screen.tsx"
import { api } from "~/lib/api";
import { authClient } from "~/lib/auth";

export default function CustomerScreen() {
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
    <View>
      <Text>{user.email}</Text>
      <Text>{customer.plan}</Text>
    </View>
  );
}
```

<Callout title="Be cautious!" type="warn">
  Be mindful when implementing payment-related features in your mobile app. Apple has strict guidelines regarding external payment systems and **may reject your app** if you aggressively redirect users to web-based payment flows. Make sure to review the [App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/#payments) carefully and consider implementing native in-app purchases for iOS users to ensure compliance.

  We are currently working on a fully native payments system that will make it easier to comply with Apple's guidelines - stay tuned for updates!
</Callout>
