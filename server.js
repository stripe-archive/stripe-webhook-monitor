"use strict";

const config = require("./config.js");
const stripe = require("stripe")(config.stripe.secretKey);
const express = require("express");
const socketio = require("socket.io");
const http = require("http");
const bodyParser = require("body-parser");
const path = require("path");
const chalk = require("chalk");

(async () => {
  const webhooksPort = config.port + 1;

  let webhookSigningSecret,
      ngrokUrl;

  // Set the Stripe dashboard URL and append in testmode
  let dashboardUrl = "https://dashboard.stripe.com/";
  if (config.stripe.secretKey.startsWith("sk_test")) {
    dashboardUrl += "test/";
  }

  if (config.ngrok.enabled) {
    const ngrok = require("ngrok");

    // Provision ngrok tunnel
    ngrokUrl = await ngrok.connect({
      addr: webhooksPort,
      subdomain: config.ngrok.subdomain,
      authtoken: config.ngrok.authtoken
    }).catch(error => {
      console.log("Error starting ngrok tunnel", error);
      process.exit(1);
    });

    // Provision Stripe webhook endpoint
    const webhookEndpoint = await stripe.webhookEndpoints.create({
      url: ngrokUrl,
      enabled_events: ['*']
    }).catch(error => {
      console.log("Error provisioning webhook endpoint", error);
      process.exit(1);
    });

    // Save webhook signing secret key
    webhookSigningSecret = webhookEndpoint.secret;

    // Tear down Stripe webhook endpoint on CTRL+C
    // (ngrok does this automatically)
    process.on('SIGINT', async () => {
      await stripe.webhookEndpoints.del(webhookEndpoint.id).catch(error => {
        const webhookManagementUrl = `${dashboardUrl}/webhooks/${webhookEndpoint.id}`;
        console.log(`Error deleting webhook endpoint, visit ${webhookManagementUrl}`, error);
        process.exit(1);
      });

      process.exit(0);
    });
  } else  {
    // Not using ngrok, but setting signing secret via config
    if (config.stripe.webhookSigningSecret) {
      webhookSigningSecret = config.stripe.webhookSigningSecret;
    }
  }

  /*
    We use two different Express servers for security reasons: our webhooks
    endpoint needs to be publicly accessible, but we don't want our monitoring
    dashboard to be publicly accessible since it may contain sensitive data.
  */

  // The first Express server will serve Stripe Monitor (on a different port).
  const monitor = express();
  const monitorServer = http.Server(monitor);
  // We'll set up Socket.io to notify us of new events
  const io = socketio(monitorServer);
  let recentEvents = [];

  // Serve static files and start the server
  monitor.use(express.static(path.join(__dirname, "public")));
  monitorServer.listen(config.port, () => {
    console.log(`Stripe Monitor is up: http://localhost:${config.port}`);
  });

  // Provides environment details: the Dashboard URL will vary based on whether we're in test or live mode
  monitor.get("/environment", async (req, res) => {
    res.send({ dashboardUrl });
  });

  // Provides the 20 most recent events (useful when the app first loads)
  monitor.get("/recent-events", async (req, res) => {
    let response = await stripe.events.list({ limit: 20 });
    recentEvents = response.data;
    res.send(recentEvents);
  });

  // The second Express server will receive webhooks
  const webhooks = express();

  webhooks.listen(webhooksPort, () => {
    const url = ngrokUrl ? ngrokUrl : `http://localhost:${webhooksPort}`;
    console.log(`Listening for webhooks: ${url}`);
  });

  // Provides an endpoint to receive webhooks
  webhooks.post("/", bodyParser.raw({ type: "application/json" }), async (req, res) => {
    let event;

    // Check if signing secret has been set
    if (webhookSigningSecret) {
      const sig = req.headers['stripe-signature'];

      try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSigningSecret);
      } catch (err) {
        console.log(
          chalk.red(`Failed to verify webhook signature: ${err.message}`)
        );
        res.sendStatus(400);
        return;
      }
    } else {
      // Signing secret is not set, just pass through
      event = req.body;
    }

    // Send a notification that we have a new event
    // Here we're using Socket.io, but server-sent events or another mechanism can be used.
    io.emit("event", event);
    // Stripe needs to receive a 200 status from any webhooks endpoint
    res.sendStatus(200);
  });
})();
