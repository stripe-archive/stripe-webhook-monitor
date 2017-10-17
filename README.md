# Stripe Webhook Monitor

`stripe-webhook-monitor` is a real-time monitor for Stripe webhooks that provides a live feeds and graph of recent events.

<img src="https://raw.githubusercontent.com/stripe/stripe-webhook-monitor/master/screenshots/monitor-feed.gif" width="425"> <img src="https://raw.githubusercontent.com/stripe/stripe-webhook-monitor/master/screenshots/monitor-graph.gif" width="425">

Stripe's platform includes [webhooks](https://stripe.com/docs/webhooks) that will notify you when actions take place on your account. For example, you can be notified when:

  - New charges are created (`charge.created`)
  - Customers subscribe to a new plan (`customer.subscription.created`)
  - Payouts and transfers are completed (`payout.paid`)
  - An invoice payment failed (`invoice.payment_failed`)

Webhooks are powerful: you can subscribe to these notifications and programmatically react to them in real-time.

## Getting started

### Requirements
You'll need to have Node v7.6+ installed, which includes support for `async` / `await`.

### Set up the monitor
Clone the project repository, and create a configuration for your Stripe account:

```
cp config.sample.js config.js
```

You'll need to fill in your Stripe secret key.

Webhooks require a public URL that Stripe will ping to notify the monitor of new events. Support for [ngrok](https://ngrok.com/) is included out of the box: ngrok will create a secure tunnel and provide a public URL to your local machine.

If you have a [__Basic__](https://ngrok.com/pricing) ngrok subscription, you can specify a custom subdomain that will stay reserved for your account.

### Start receiving changes

To start the monitor:

```
npm install
npm start
```

Take note of the public URL provided by ngrok: it should be listed when the monitor starts.

**Don't want to use ngrok?** As long as Stripe can reach the webhooks endpoint via a public URL, you'll receive  updates.

### Subscribe to webhook notifications

In your Stripe Dashboard, go to the _API_ section, then click on the _Webhooks_ tab.

You should add a receiving endpoint by clicking _Add Endpoint_. Fill in the public URL provided by ngrok, or any other public URL that can reach the webhook monitor.

![](https://raw.githubusercontent.com/stripe/stripe-webhook-monitor/master/screenshots/setting-up-webhooks.png)

## Troubleshooting

### I'm not receiving real-time updates

- Check that the [Stripe Dashboard](https://dashboard.stripe.com/webhooks/) is listing your webhook route as _Enabled_.
- Make sure that the webhook endpoint matches the URL printed in your console.

## Credits

- Code: [Michael Glukhovsky](https://twitter.com/mglukhovsky)
- Icons: [Ionicons](http://ionicons.com/)
