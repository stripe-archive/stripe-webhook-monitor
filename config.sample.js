'use strict';

module.exports = {
  port: 4000,
  stripe: {
    // Include your Stripe secret key here
    secretKey: 'YOUR_STRIPE_SECRET_KEY'
  },
  /*
     Stripe needs a public URL for our server that it can ping with new events.
     If ngrok is enabled, this server will create a public endpoint for you.
  */
  ngrok: {
    enabled: true,
    /*
       Optional: if you have a Pro ngrok account you can provide a custom
       subdomain and your authentication token here.
    */
    subdomain: null,
    authtoken: null
  }
}
