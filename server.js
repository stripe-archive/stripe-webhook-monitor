"use strict";

const config = require("./config.js");
const boxen = require("boxen");
const stripe = require("stripe")(config.stripe.secretKey);
const express = require("express");
const socketio = require("socket.io");
const http = require("http");
const bodyParser = require("body-parser");
const path = require("path");
const chalk = require("chalk");

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
  let dashboardUrl = "https://dashboard.stripe.com/";
  if (config.stripe.secretKey.startsWith("sk_test")) {
    dashboardUrl += "test/";
  }
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
const webhooksPort = config.port + 1;

webhooks.use(bodyParser.json());
webhooks.listen(webhooksPort, () => {
  console.log(`Listening for webhooks: http://localhost:${webhooksPort}`);
});

// Provides an endpoint to receive webhooks
webhooks.post("/", async (req, res) => {
  let event = req.body;
  // Send a notification that we have a new event
  // Here we're using Socket.io, but server-sent events or another mechanism can be used.
  io.emit("event", event);
  // Stripe needs to receive a 200 status from any webhooks endpoint
  res.sendStatus(200);
});

// Use ngrok to provide a public URL for receiving webhooks
if (config.ngrok.enabled) {
  const ngrok = require("ngrok");
  const boxen = require("boxen");

  ngrok.connect(
    {
      addr: webhooksPort,
      subdomain: config.ngrok.subdomain,
      authtoken: config.ngrok.authtoken
    },
    function(err, url) {
      if (err) {
        console.log(err);
        if (err.code === "ECONNREFUSED") {
          console.log(
            chalk.red(`Connection refused at ${err.address}:${err.port}`)
          );
          process.exit(1);
        }
        console.log(chalk.yellow(`ngrok reported an error: ${err.msg}`));
        console.log(
          boxen(err.details.err.trim(), {
            padding: { top: 0, right: 2, bottom: 0, left: 2 }
          })
        );
      }
      console.log(` └ Public URL for receiving Stripe webhooks: ${url}`);
    }
  );
}
