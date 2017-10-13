Vue.use(VueRouter);
Vue.config.devtools = true;

const store = {
  events: [],
  eventTypes: [],
  eventColors: {},
  eventCount: {},
  socket: null,
  loading: true,
  pausedEvents: [],
  eventsPaused: false,
  dashboardUrl: null,
  filteredHidden: [],
  showingOptions: false,
  optionsSticky: false,
  // Event statistics
  stats: {
    // Track the number of events for each of the given event types
    numEvents: [],
    lastEventCount: {},
    // Maximum number of samples we'll measure
    maxEventCount: 40,
    // Sampling interval (in ms)
    interval: 1500,
    ready: false
  },
  colors: [
    // stripe4 colors
    "#6b7c93",
    "#6772e5",
    "#3297d3",
    "#24b47e",
    "#e39f48",
    "#e37c4c",
    "#e25950",
    "#b76ac4",
    "#8f6ed5",
    // stripe6 colors
    "#aab7c4",
    "#87bbfd",
    "#68d4f8",
    "#74e4a2",
    "#fcd669",
    "#fdbc72",
    "#ffcca5",
    "#ffc7ee",
    "#cdd1f7"
  ]
};

// Toggle a flag that pauses the event stream and starts queuing them silently
store.togglePausedEvents = function togglePausedEvents() {
  if (store.eventsPaused) {
    store.events = store.pausedEvents.concat(store.events);
    store.eventsPaused = false;
  } else {
    store.eventsPaused = true;
  }
};

// Add an event to the store
store.addEvent = function addEvent(event) {
  // Track the event type  (so we can filter by them)
  if (store.eventTypes.indexOf(event.type) === -1) {
    store.eventTypes.push(event.type);
    Vue.set(store.eventColors, event.type, store.colors.shift());
    Vue.set(store.eventCount, event.type, 1);
  } else {
    let count = store.eventCount[event.type];
    Vue.set(store.eventCount, event.type, count + 1);
  }
  // If the event stream is paused, add the event to a silent queue
  if (store.eventsPaused) {
    store.pausedEvents.unshift(event);
  } else {
    store.events.unshift(event);
  }
};

// Get a human-readable version for Stripe event types
store.humanEventType = function humanEventType(type) {
  // We'll derive a human-readable version from the machine-readable type, but
  // there are a few special cases.
  specialCases = {
    "account.external_account.created": "External account created",
    "account.external_account.updated": "External account updated",
    "account.external_account.deleted": "External account deleted",
    "charge.dispute.funds_reinstated": "Charge dispute: funds reinstated",
    "charge.dispute.funds_withdrawn": "Charge dispute: funds withdrawn",
    "invoiceitem.created": "Invoice item created",
    "invoiceitem.deleted": "Invoice item deleted",
    "invoiceitem.updated": "Invoice item updated",
    "sku.created": "SKU created",
    "sku.updated": "SKU updated",
    "sku.deleted": "SKU deleted"
  };
  if (type in specialCases) {
    return specialCases[type];
  }
  // Replace all periods and underscores with spaces
  let readable = type.replace(/(\.|_)/g, " ");
  // Capitalize
  return readable.charAt(0).toUpperCase() + readable.slice(1);
};

store.recalculateStats = function recalculateStats() {
  let lastEventCount = store.stats.lastEventCount;
  let newEventCount = {
    timestamp: Date.now()
  };

  Object.keys(store.eventCount).forEach(type => {
    // First time seeing this event type? Set its inital count to zero.
    if (!(type in lastEventCount)) {
      lastEventCount[type] = 0;
      store.fillStats(type);
    }
    // For each type, compute the difference
    newEventCount[type] = store.eventCount[type] - lastEventCount[type];
    lastEventCount[type] = store.eventCount[type];
  });

  // Add the new data point, drop the last
  store.stats.numEvents.shift();
  store.stats.numEvents.push(newEventCount);

  window.dispatchEvent(new Event("newStats"));
  return store.stats.numEvents;
};

// Helper function to pad the statistics array with zero-counts for new events
store.fillStats = function fillStats(eventType) {
  let arr = store.stats.numEvents;
  for (let i = 0; i < arr.length; i++) {
    arr[i][eventType] = 0;
  }
};

// Start tracking statistics on webhooks (for use in visualizations, etc.)
store.startTrackingStats = function startTrackingStats() {
  let timestamp = Date.now();
  let stats = store.stats;

  // Prepare our statistics array with timestamps
  stats.numEvents = Array(stats.maxEventCount);
  for (let i = 0; i < stats.numEvents.length; i++) {
    stats.numEvents[i] = {
      timestamp: timestamp - (stats.numEvents.length - i) * store.stats.interval
    };
  }

  // Fill our statistics arrays with default data (for each event type)
  for (let type in store.eventCount) {
    store.fillStats(type);
  }

  // Inform other components that we're now fully tracking statistics
  window.dispatchEvent(new Event("statsReady"));
  stats.ready = true;

  // Recalculate our statistics on a regular interval
  setInterval(store.recalculateStats, store.stats.interval);
};

// Get basic information on our Stripe environment
async function getStripeInfo() {
  try {
    let response = await fetch("/environment");
    if (response.status === 200) {
      let stripeInfo = await response.json();
      store.dashboardUrl = stripeInfo.dashboardUrl;
    }
  } catch (e) {
    console.log("Couldn't connect to backend:", e);
  }
}

// Subscribe to a realtime stream from the backend via Socket.io
async function subscribeEvents() {
  // Fetch the most recent events from the server
  try {
    let response = await fetch("/recent-events");
    if (response.status === 200) {
      let recentEvents = await response.json();
      for (event of recentEvents) {
        store.addEvent(event);
      }
    }
  } catch (e) {
    console.log("Couldn't connect to backend:", e);
  }

  store.loading = false;
  // Subscribe to new events via Socket.io
  store.socket = io.connect();
  // Whenever we receive an event via Socket.io, update our store
  store.socket.on("event", event => {
    if (event.type != "ping") {
      store.addEvent(event);
    }
  });

  // Start tracking statistics on new events
  store.startTrackingStats();
}

Vue.component("event", {
  props: ["event"],
  data() {
    return {
      store,
      showingJSON: false,
      showingMetadata: false,
      metadata: this.event.data.object.metadata
    };
  },
  computed: {
    // Generate a human-readable event type
    eventType() {
      return store.humanEventType(this.event.type);
    },
    // Use a specific color for some types of events
    eventColor() {
      if (this.event.type in store.eventColors) {
        return "border-left-color: " + store.eventColors[this.event.type] + ";";
      }
    },
    // Whether this event has metadata
    hasMetadata() {
      // Only core objects (like Sources or Charges) have metadata
      if (!this.metadata) {
        return false;
      }
      return Object.keys(this.metadata).length > 0;
    },
    // For some types of events, show a summary
    summary() {
      let evt = this.event.data.object;
      // Render an HTML link to the Stripe Dashboard
      const url = (route, text) => {
        return `<a target="_blank" href="${store.dashboardUrl}${route}">${text}</a>`;
      };
      // Render a currency, take an amount (in USD, dollars) and a currency
      const currency = (amount, currency) => {
        return OSREC.CurrencyFormatter.format(amount, { currency });
      };
      // Render a date: takes a timestamp (milliseconds since epoch)
      const date = timestamp => moment(timestamp).format("MMMM Do, YYYY");

      if (this.event.type === "account.external_account.created") {
        return `A new external account was created.`;
      } else if (this.event.type === "account.external_account.deleted") {
        return `A new external account was deleted.`;
      } else if (this.event.type === "account.external_account.updated") {
        return `A new external account was updated.`;
      } else if (this.event.type === "account.updated") {
        return `The Stripe account was updated.`;
      } else if (this.event.type === "balance.available") {
        return `The balance for this Stripe account was updated:
        ${currency(
          evt.available[0].amount / 100,
          evt.available.currency
        )} is available,
        ${currency(
          evt.pending[0].amount / 100,
          evt.pending.currency
        )} is pending.`;
      } else if (this.event.type === "charge.captured") {
        return `Customer ${url("customers/" + evt.customer, evt.customer)}'s'
          charge for ${currency(evt.amount / 100, evt.currency)} was
          ${url("charges/" + evt.id, "captured")}.`;
      } else if (this.event.type === "charge.dispute.closed") {
        return `The ${url("disputes/" + evt.id, "dispute")} for a
          ${url("charges/" + evt.charge, "charge")} was closed.`;
      } else if (this.event.type === "charge.dispute.created") {
        return `The ${url("disputes/" + evt.id, "dispute")} for a
          ${url("charges/" + evt.charge, "charge")} was created.`;
      } else if (this.event.type === "charge.dispute.funds_reinstated") {
        return `${currency(
          evt.amount / 100,
          evt.currency
        )} was reinstated to the
          Stripe account following a ${url("disputes/" + evt.id, "dispute")}.`;
      } else if (this.event.type === "charge.dispute.funds_withdrawn") {
        return `${currency(
          evt.amount / 100,
          evt.currency
        )} was withdrawn from the
          Stripe account following a ${url("disputes/" + evt.id, "dispute")}.`;
      } else if (this.event.type === "charge.dispute.updated") {
        return `The ${url("disputes/" + evt.id, "dispute")} for a
          ${url("charges/" + evt.charge, "charge")} was updated.`;
      } else if (this.event.type === "charge.failed") {
        return `A recent ${url("charges/" + evt.id, "charge")} for
          ${currency(evt.amount / 100, evt.currency)} failed.`;
      } else if (this.event.type === "charge.pending") {
        return `A recent ${url("charges/" + evt.id, "charge")} for
          ${currency(evt.amount / 100, evt.currency)} is pending.`;
      } else if (this.event.type === "charge.refund.updated") {
        return `A ${currency(evt.amount / 100, evt.currency)} refund for a
        ${url("charges/" + evt.id, "charge")} was updated.`;
      } else if (this.event.type === "charge.refunded") {
        return `A ${currency(evt.amount / 100, evt.currency)}
          ${url("charges/" + evt.id, "charge")} was refunded.`;
      } else if (this.event.type === "charge.succeeded") {
        return `A ${url("customers/" + evt.customer, "customer")}
          was charged ${currency(evt.amount / 100, evt.currency)}
          with a ${evt.source.brand} ${evt.source.funding} ${evt.source
          .object}.`;
      } else if (this.event.type === "charge.updated") {
        return `A ${currency(evt.amount / 100, evt.currency)}
          ${url("charges/" + evt.id, "charge")} was updated.`;
      } else if (this.event.type === "coupon.created") {
        return `A coupon was created.`;
      } else if (this.event.type === "coupon.deleted") {
        return `A coupon was deleted.`;
      } else if (this.event.type === "coupon.updated") {
        return `A coupon was updated.`;
      } else if (this.event.type === "customer.bank_account.deleted") {
        return `A ${url("customers/" + evt.id, "customer")}'s bank account was
          deleted.`;
      } else if (this.event.type === "customer.created") {
        return `A ${url("customers/" + evt.id, "new customer")}
          ${evt.email ? "(" + evt.email + ")" : ""} was created.`;
      } else if (this.event.type === "customer.deleted") {
        return `A ${url("customers/" + evt.id, " customer")}
          ${evt.email ? "(" + evt.email + ")" : ""} was deleted.`;
      } else if (this.event.type === "customer.discount.created") {
        return `A discount for a ${url("customers/" + evt.id, "customer")} was
          created.`;
      } else if (this.event.type === "customer.discount.deleted") {
        return `A discount for a ${url("customers/" + evt.id, "customer")} was
          deleted.`;
      } else if (this.event.type === "customer.discount.updated") {
        return `A discount for a ${url("customers/" + evt.id, "customer")} was
          updated.`;
      } else if (this.event.type === "customer.source.created") {
        return `A ${url("customers/" + evt.customer, "customer")} added a new
          payment source.`;
      } else if (this.event.type === "customer.source.deleted") {
        return `A ${url("customers/" + evt.customer, "customer")} deleted a
          payment source.`;
      } else if (this.event.type === "customer.source.updated") {
        return `A ${url("customers/" + evt.customer, "customer")} updated a
          payment source.`;
      } else if (this.event.type === "customer.subscription.created") {
        return `A ${url("customers/" + evt.customer, "customer")}
          created a new ${url("subscriptions/" + evt.id, "subscription")} to the
          ${url("plans/" + evt.plan.id, evt.plan.name)} plan.`;
      } else if (this.event.type === "customer.subscription.deleted") {
        return `A ${url("customers/" + evt.customer, "customer")}
          deleted a ${url("subscriptions/" + evt.id, "subscription")} to the
          ${url("plans/" + evt.plan.id, evt.plan.name)} plan.`;
      } else if (this.event.type === "customer.subscription.trial_will_end") {
        return `A ${url("customers/" + evt.customer, "customer")}'s trial
          ${url("subscriptions/" + evt.id, "subscription")} will end on
          ${date(evt.trial_end)}.`;
      } else if (this.event.type === "customer.subscription.updated") {
        return `A ${url("customers/" + evt.customer, "customer")}'s
          ${url("subscriptions/" + evt.id, "subscription")} was updated.`;
      } else if (this.event.type === "customer.updated") {
        return `A ${url("customers/" + evt.customer, "customer")} was updated.`;
      } else if (this.event.type === "file.created") {
        return `A new file was uploded.`;
      } else if (this.event.type === "invoice.created") {
        return `A ${url("customers/" + evt.customer, "customer")}'s
          ${url("invoices/" + evt.id, "invoice")} was created.`;
      } else if (this.event.type === "invoice.payment_failed") {
        return `A ${url("customers/" + evt.customer, "customer")}'s
          ${url("invoices/" + evt.id, "invoice")} invoice payment failed.`;
      } else if (this.event.type === "invoice.payment_succeeded") {
        return `A ${url("customers/" + evt.customer, "customer")}'s
          ${url("invoices/" + evt.id, "invoice")} was successfully charged.`;
      } else if (this.event.type === "invoice.sent") {
        return `A ${url("customers/" + evt.customer, "customer")}'s
          ${url("invoices/" + evt.id, "invoice")} was sent.`;
      } else if (this.event.type === "invoice.upcoming") {
        return `A ${url("customers/" + evt.customer, "customer")}'s
          ${url("invoices/" + evt.id, "invoice")} was updated.`;
      } else if (this.event.type === "invoice.updated") {
        return `A ${url("customers/" + evt.customer, "customer")}'s
          ${url("invoices/" + evt.id, "invoice")} was updated.`;
      } else if (this.event.type === "invoiceitem.created") {
        return `A ${url(
          "customers/" + evt.customer,
          "customer"
        )} created an invoice
          item${evt.invoice
            ? " for an " + url("invoices/" + evt.invoice, "invoice")
            : ""}.`;
      } else if (this.event.type === "invoiceitem.deleted") {
        return `A ${url(
          "customers/" + evt.customer,
          "customer"
        )} deleted an invoice
          item${evt.invoice
            ? " for an " + url("invoices/" + evt.invoice, "invoice")
            : ""}.`;
      } else if (this.event.type === "invoiceitem.updated") {
        return `A ${url(
          "customers/" + evt.customer,
          "customer"
        )} updated an invoice
          item${evt.invoice
            ? " for an " + url("invoices/" + evt.invoice, "invoice")
            : ""}.`;
      } else if (this.event.type === "order.created") {
        return `A new ${url("orders/" + evt.id, "order")} for
          ${currency(evt.amount / 100)} was created.`;
      } else if (this.event.type === "order.payment_failed") {
        return `A payment failed for an ${url("orders/" + evt.id, "order")} for
          ${currency(evt.amount / 100)}.`;
      } else if (this.event.type === "order.payment_succeeded") {
        return `A payment succeeded for an ${url(
          "orders/" + evt.id,
          "order"
        )} for
          ${currency(evt.amount / 100)}.`;
      } else if (this.event.type === "order.updated") {
        return `An ${url("orders/" + evt.id, "order")} for
          ${currency(evt.amount / 100)} was updated.`;
      } else if (this.event.type === "order_return.created") {
        return `A return was created for an ${url(
          "orders/" + evt.order,
          "order"
        )}
        for ${currency(evt.amount / 100)}.`;
      } else if (this.event.type === "payout.canceled") {
        return `A payout of ${currency(evt.amount / 100)} was canceled.`;
      } else if (this.event.type === "payout.created") {
        return `A payout of ${currency(evt.amount / 100)} was initiated.`;
      } else if (this.event.type === "payout.failed") {
        return `A payout of ${currency(evt.amount / 100)} was failed.`;
      } else if (this.event.type === "payout.paid") {
        return `A payout of ${currency(evt.amount / 100)} was paid.`;
      } else if (this.event.type === "payout.updated") {
        return `A payout of ${currency(evt.amount / 100)} was updated.`;
      } else if (this.event.type === "plan.created") {
        return `Plan ${url("plans/" + evt.id, evt.name)} was created.`;
      } else if (this.event.type === "plan.deleted") {
        return `Plan ${evt.name} was deleted.`;
      } else if (this.event.type === "plan.updated") {
        return `Plan ${evt.name} was updated.`;
      } else if (this.event.type === "product.created") {
        return `A new ${url("products/" + evt.id, "product")} was created.`;
      } else if (this.event.type === "product.deleted") {
        return `A ${url("products/" + evt.id, "product")} was deleted.`;
      } else if (this.event.type === "product.updated") {
        return `A ${url("products/" + evt.id, "product")} was updated.`;
      } else if (this.event.type === "recipient.created") {
        return `A new recipient was created.`;
      } else if (this.event.type === "recipient.deleted") {
        return `A new recipient was deleted.`;
      } else if (this.event.type === "recipient.updated") {
        return `A new recipient was updated.`;
      } else if (this.event.type === "review.closed") {
        return `A fraud review was closed.`;
      } else if (this.event.type === "review.opened") {
        return `A fraud review was opened.`;
      } else if (this.event.type === "sku.created") {
        return `A ${url(
          "products/" + evt.product,
          "product"
        )} SKU was created.`;
      } else if (this.event.type === "sku.deleted") {
        return `A ${url(
          "products/" + evt.product,
          "product"
        )} SKU was deleted.`;
      } else if (this.event.type === "sku.updated") {
        return `A ${url(
          "products/" + evt.product,
          "product"
        )} SKU was updated.`;
      } else if (this.event.type === "source.canceled") {
        return `A payment source was canceled.`;
      } else if (this.event.type === "source.chargeable") {
        return `A payment source is now chargeable.`;
      } else if (this.event.type === "source.failed") {
        return `A payment source failed.`;
      } else if (this.event.type === "source.transaction_created") {
        return `A transaction was created for a payment source.`;
      } else if (this.event.type === "transfer.created") {
        return `A transfer was created.`;
      } else if (this.event.type === "transfer.reversed") {
        return `A transfer was reversed.`;
      } else if (this.event.type === "transfer.updated") {
        return `A transfer was updated.`;
      }
    }
  },
  filters: {
    timeAgo: created => moment(created * 1000).fromNow()
  },
  methods: {
    viewDashboard() {
      window.open(`${store.dashboardUrl}events/${this.event.id}`, "_blank");
    }
  },
  template: `
  <transition name="event-slide">
    <div class="event">
      <header>
        <p class="eventType">{{ eventType }}</p>
        <p class="timestamp"><em>{{ event.created | timeAgo }}</em></p>
      </header>
      <section class="event-body">
        <section class="details">
          <section class="text-description" :style="eventColor">
            <p class="summary" v-html="summary"></p>
            <p class="description">{{ this.event.data.object.description }}</p>
          </section>
        </section>
        <button @click="viewDashboard">View on Stripe <i class="icon icon-right ion-chevron-right"></i></button>
      </section>
      <section class="event-data">
        <section :class="{expanded: showingJSON, showJSON: true}">
          <p class="show-event-data" @click="showingJSON = !showingJSON" >
            <i class="json-arrow icon ion-arrow-right-b"></i>
            <span v-if="showingJSON">Hide</span><span v-else>Inspect</span> JSON
          </p>
          <eventJSON v-if="showingJSON" :json="event"></eventJSON>
        </section>
        <section v-if="hasMetadata" :class="{expanded: showingMetadata, 'show-metadata': true}">
          <p class="show-event-data" @click="showingMetadata = !showingMetadata" >
            <i class="metadata-arrow icon ion-arrow-right-b"></i>
            <span v-if="showingMetadata">Hide</span><span v-else>Show</span> metadata
          </p>
          <eventJSON v-if="showingMetadata" :json="metadata"></eventJSON>
        </section>
      </section>
    </div>
  </transition>
  `
});

Vue.component("eventJSON", {
  props: ["json"],
  data() {
    return {
      // Tuples of regular expressions for Stripe resources (IDs, charges, customers) and the Stripe dashboard resource URL
      knownUrls: [
        [/(")(evt_.+)(")/g, `${store.dashboardUrl}events/`],
        [/(")(cus_.+)(")/g, `${store.dashboardUrl}customers/`],
        [/(")(ch_.+)(")/g, `${store.dashboardUrl}charges/`],
        [/(")(dp.+)(")/g, `${store.dashboardUrl}disputes/`],
        [/(")(in.+)(")/g, `${store.dashboardUrl}invoices/`]
      ]
    };
  },
  mounted() {
    // Use Prism to add syntax highlighting
    Prism.highlightElement(this.$refs.code);
    // Highlight links in our webhook event's JSON payload
    let $strings = this.$refs.code.querySelectorAll("span.token.string");
    // Look at each string token
    for (const $string of $strings) {
      // See if we recognize the token and can add a link to the Dashboard
      for (let i = 0; i < this.knownUrls.length; i++) {
        const regex = this.knownUrls[i][0];
        const url = this.knownUrls[i][1];
        const match = regex.exec($string.innerText);
        if (match && match.length === 4) {
          // Wrap the token in a link tag
          $string.innerHTML = `${match[1]}<a target="_blank" href="${url}${match[2]}">${match[2]}</a>${match[3]}`;
          break;
        }
      }
    }
  },
  filters: {
    prettify: json => JSON.stringify(json, null, 2)
  },
  template: `
    <pre class="eventJSON"><code class="language-json" ref="code">{{ json | prettify }}</code></pre>
  `
});

Vue.component("logs", {
  data() {
    return { store };
  },
  template: `
    <section class="monitor has-options">
      <section :class="{eventList: true, 'options-sticky': store.optionsSticky}">
        <transition-group v-if="store.events.length > 0" name="eventList" tag="ul">
          <li v-for="evt in store.events" :key="evt.id">
            <event v-if="store.filteredHidden.indexOf(evt.type) === -1" :event="evt"></event>
          </li>
        </transition-group>
        <p v-else-if="store.loading === true">Loading...</p>
        <p v-else>No recent events.</p>
      </section>
      <monitor-options></monitor-options>
    </section>
  `
});

Vue.component("charts", {
  data() {
    return {
      store,
      graph: null,
      data: [],
      month: new Date(2014, 0, 1),
      ticking: false,
      filtering: false,
      transitioning: false,
      plotted: false,
      animationSpeed: 150,
      easing: d3.easeCubicIn,
      listeners: {},
      // Selections to create and remove before and after transitions
      removeQueue: null,
      createQueue: null,
      // Current translation offset of elements that are drawn on the page
      translateOffset: 0,
      plot: {
        x: null,
        y: null,
        svg: null,
        area: null,
        xAxisGroup: null,
        yAxisGroup: null,
        xAxis: null,
        yAxis: null,
        stack: null,
        layer: null,
        path: null,
        data: null
      }
    };
  },
  methods: {
    xDomain(data) {
      let lastDate = new Date(data[data.length - 2].timestamp);
      let firstDate = new Date(data[0].timestamp);
      return [firstDate, lastDate];
    },
    yDomain(data) {
      // Get the maximum of the total number of event types
      let max = d3.max(data, d => {
        // Sum the values for each event type
        return d3.sum(this.keys(), key => d[key]) * 1.2;
      });
      return [0, max];
    },
    keys() {
      return store.eventTypes.filter(
        key => store.filteredHidden.indexOf(key) < 0
      );
    },
    // Visually update the areas of the stacked graph
    updateAreas(selection) {
      selection.attr("d", this.plot.area);
      if (this.createQueue) {
        this.createQueue.attr("d", this.plot.area);
        this.createQueue = null;
      }
      if (this.removeQueue) {
        this.removeQueue.remove();
        this.removeQueue = null;
      }
    },
    // Animate the areas of the stacked graph
    animateAreas(selection) {
      // Calculate how far we'll want to slide each area:
      // in this case, one time interval on the plot
      const previousStatement = new Date(
        this.plot.data[0].timestamp - store.stats.interval
      );
      const translateOffset = this.plot.x(previousStatement);
      // Set the actual offset to zero at the start of the transition
      this.translateOffset = 0;
      // Set the `transitioning` state if there are elements to transition
      if (!selection.empty()) {
        this.transitioning = true;
      }

      selection
        // Set the original translate offset to zero
        .attr("transform", "translate(0)")
        .transition()
        // Slide each area across the plot
        .duration(this.animationSpeed)
        .ease(this.easing)
        .attr("transform", `translate(${translateOffset})`)
        .on("end", () => {
          this.translateOffset = translateOffset;
          this.transitioning = false;
          this.filtering = false;
        });
    },
    updateGraph() {
      // If the event stream is paused, don't update the graph
      if (store.eventsPaused || document.hidden) {
        return;
      }
      // Define the animation behavior (speed and easing)
      const plot = this.plot;
      const data = store.stats.numEvents;
      plot.data = data;

      // Use a stack layout to create our stacked area graph
      plot.stack = d3
        .stack()
        .keys(this.keys())
        .order(d3.stackOrderNone)
        .offset(d3.stackOffsetNone);

      // Bind the data to the layer
      const layer = plot.svg
        .selectAll(".layer")
        .data(plot.stack(data), d => d.key);

      // Recalculate the domains of each axis
      plot.x.domain(this.xDomain(data));
      plot.y.domain(this.yDomain(data));

      // Update the axes
      plot.xAxisGroup
        .transition()
        .duration(this.animationSpeed)
        .ease(this.easing)
        .call(plot.xAxis);
      plot.yAxisGroup
        .transition()
        .duration(this.animationSpeed)
        .ease(this.easing)
        .call(plot.yAxis);

      // Enter new elements
      layer
        .enter()
        .append("g")
        .attr("class", d => `layer ${d.key}`)
        .attr("clip-path", "url(#clip)")
        .append("path")
        // Set up paths for new elements (but don't actually plot them yet)
        .attr("class", d => `area ${d.key}`)
        .style("fill", (d, i) => store.eventColors[d.key])
        .call(selection => {
          // If we're not in the middle of a transition, visually update the plot
          if (!this.transitioning) {
            selection
              .attr("d", plot.area)
              .attr("transform", `translate(${this.translateOffset})`);
          } else {
            // Otherwise, add it to a creation queue
            this.createQueue = selection;
          }
        });

      // Remove exited elements
      layer.exit().call(selection => {
        this.removeQueue = selection;
      });

      // Visually update the plot (when we're not filtering or transitioning)
      if (!this.transitioning && !this.filtering) {
        layer
          .select(".area")
          .call(this.updateAreas)
          .call(this.animateAreas);
      } else {
        // If we've just filtered our data:
        if (this.filtering) {
          // ...and we're not in the middle of a transition, visually update the plot
          if (!this.transitioning) {
            layer.select(".area").call(this.updateAreas);
          }
          // Otherwise, skip this update cycle (but make sure we update +
          // animate the plot on the next cycle)
          this.filtering = false;
        }
      }
    },
    drawGraph() {
      const plot = this.plot;
      const data = store.recalculateStats();
      plot.data = data;

      let $recentEvents = this.$refs.recentEvents;
      // Build the SVG plot
      const padding = { horizontal: 20, vertical: 20 },
        width = $recentEvents.offsetWidth - padding.horizontal,
        height = $recentEvents.offsetHeight - padding.vertical;

      plot.x = d3
        .scaleTime()
        // Find the largest and smallest dates for the domain
        .domain(this.xDomain(data))
        .range([0, width]);
      plot.y = d3
        .scaleLinear()
        // Set the domain to the highest event count
        .domain(this.yDomain(data))
        .range([height, 0]);

      plot.svg = d3
        .select("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("width", width)
        .attr("height", height)
        .attr(
          "transform",
          `translate(${padding.vertical},-${padding.horizontal})`
        );

      plot.svg
        .append("defs")
        .append("clipPath")
        .attr("id", "clip")
        .append("rect")
        .attr("width", width)
        .attr("height", height);

      // Build our area graph
      plot.area = d3
        .area()
        // The x axis is based on time
        .x((d, i) => plot.x(new Date(d.data.timestamp)))
        // y0 and y1 represent the bottom and top values for each section of the area graph
        .y0(d => plot.y(d[0]))
        .y1(d => plot.y(d[1]))
        .curve(d3.curveBasis);

      // Define the visual axes on the plot
      plot.xAxis = d3
        .axisBottom()
        .scale(plot.x)
        .tickFormat(d3.timeFormat("%H:%M:%S"));
      plot.yAxis = d3.axisLeft().scale(plot.y);

      // Add our axes to the plot
      plot.xAxisGroup = plot.svg
        .append("g")
        .attr("class", "x axis")
        .attr("transform", `translate(0, ${height})`)
        .attr("clip-path", "url(#clip)")
        .call(plot.xAxis);
      plot.yAxisGroup = plot.svg
        .append("g")
        .attr("class", "y axis")
        .call(plot.yAxis);

      // Update the graph to use our data set: we've now fully plotted the graph
      this.updateGraph(data);
      this.plotted = true;
    }
  },
  destroyed() {
    // Remove all of the event listeners on `window`
    window.removeEventListener("statsReady", this.drawGraph);
    window.removeEventListener("newStats", this.listeners.newStats);
    window.removeEventListener("filteredType", this.listeners.filteredType);
    window.removeEventListener("resize", this.listeners.resize);
  },

  mounted() {
    // Wait for stats to be ready before drawing the graph
    if (store.stats.ready) {
      this.drawGraph();
    } else {
      // Draw the graph once statistics are set up
      window.addEventListener("statsReady", this.drawGraph);
    }

    // Tick the graph whenever new stats are available
    this.listeners.newStats = () => {
      if (this.plotted) {
        this.updateGraph();
      }
    };
    window.addEventListener("newStats", this.listeners.newStats);

    // Visually update the graph whenever data is filtered (by event type)
    this.listeners.filteredType = () => {
      if (this.plotted) {
        this.filtering = true;
        this.updateGraph();
      }
    };
    window.addEventListener("filteredType", this.listeners.filteredType);

    // Redraw the graph after the window has been resized
    let onResize;
    this.listeners.resize = () => {
      clearTimeout(onResize);
      onResize = setTimeout(() => {
        const svg = d3.select("svg");
        svg
          .attr("width", null)
          .attr("height", null)
          .selectAll("*")
          .remove();

        this.drawGraph();
      }, 200);
    };
    window.addEventListener("resize", this.listeners.resize);
  },
  template: `
    <section class="monitor has-options">
      <section class="charts fill-view">
        <h1>Recent webhook events</h1>
        <section ref="recentEvents" class="recentEvents">
          <svg></svg>
        </section>
      </section>
      <monitor-options></monitor-options>
    </section>
  `
});

Vue.component("monitor-options", {
  data() {
    return {
      store
    };
  },
  mounted() {
    const waypoint = new Waypoint({
      element: this.$refs.monitorOptions,
      handler: direction => {
        if (direction == "down") {
          store.optionsSticky = true;
        } else {
          store.optionsSticky = false;
        }
      }
    });
  },
  methods: {
    toggleType(type) {
      let index = store.filteredHidden.indexOf(type);
      if (index > -1) {
        store.filteredHidden.splice(index, 1);
      } else {
        store.filteredHidden.push(type);
      }
      window.dispatchEvent(new Event("filteredType"));
    },
    colorize(type) {
      return store.eventColors[type];
    }
  },
  template: `
    <nav
      :class="{'monitor-options': true, showing: store.showingOptions, sticky: store.optionsSticky }"
      ref="monitorOptions">
      <div class="sentinel" ref="sentinel"></div>
      <section class="filterEvents">
        <h1>Filter events</h1>
        <ul v-for="(eventCount, eventType) in store.eventCount">
          <li class="filter">
            <label>
              <input checked type="checkbox" v-on:change="toggleType(eventType)">
              <span class="checkbox"></span>
              <span class="color" v-bind:style="{'background-color': colorize(eventType)}"></span>
              <span class="type">{{store.humanEventType(eventType)}}</span>
              <span class="count">({{eventCount}})</span>
            </label>
          </li>
        </ul>
      </section>
    </nav>
  `
});

const router = new VueRouter({
  //base: window.location.href,
  routes: [
    { name: "logs", path: "/", component: Vue.component("logs") },
    { name: "charts", path: "/charts", component: Vue.component("charts") }
  ]
});

const app = new Vue({
  el: "#app",
  router: router,
  data() {
    return { store };
  },
  created() {
    // Gather info on our Stripe account and start our subscription
    getStripeInfo();
    subscribeEvents();
  },
  template: `
    <div id="app">
      <header class="app-header">
        <nav>
          <router-link tag="h1" :to="{ path: '/' }" exact><a>Stripe Monitor</a></router-link>
          <router-link tag="h2" :to="{ path: '/' }" exact><a>Logs</a></router-link>
          <router-link tag="h2" :to="{ path: 'charts'}"><a>Charts</a></router-link>
        </nav>
        <button class="pause-events" @click="store.togglePausedEvents()">
          <span v-if="store.eventsPaused">
            <i class="icon ion-play"></i>
            <span class="button-text">Resume updates</span>
          </span>
          <span v-else>
            <i class="icon ion-pause"></i>
            <span class="button-text">Pause updates</span>
          </span>
        </button>
        <button class="show-monitor-options" :class="{active: store.showingOptions}" @click="store.showingOptions = !store.showingOptions">
          <i class="icon ion-gear-a"></i>
          <span class="button-text">
            <span v-if="store.showingOptions">Hide options</span>
            <span v-else>Show options</span>
          </span>
        </button>
      </header>
      <router-view></router-view>
    </div>
  `
});

window.app = app;
