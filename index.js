const moment = require('moment');
const Octokit = require('@octokit/rest');

const { get } = require('lodash');

const {
  createProgressBar,
  createQueue,
} = require('api-toolkit');

const { getRateLimits, setRateLimitOnQueue } = require('./utils/rateLimits');

// We can check 5000 * per hour but we will limit it to every 10 seconds
const RATE_LIMIT_AUTO_FETCH_INTERVAL = 10000;

const ON_RATE_LIMIT_TIMEOUT = RATE_LIMIT_AUTO_FETCH_INTERVAL;

// how many pending requests can we have per endpoint
const MAX_CONCURRENT_FETCH = 2;

module.exports = class GithubToolkit {
  constructor(opts) {
    // because constructor can't be async
    this.init(opts);
  }

  async init({
    autoFetchRateLimits = true,
    showProgressBar = true,
    progressBar,
    auth: {
      token,
    },
  }) {
    let readyResolver;

    // listen to this for ready
    this.ready = new Promise((res) => {
      readyResolver = res;
    });
    this.queues = {};

    // holds rate limits
    this.rateLimits = {};

    this.client = Octokit();
    this.client.authenticate({
      type: 'token',
      token,
    });

    this.getRateLimits = getRateLimits.bind(null, this);
    this.setRateLimitOnQueue = setRateLimitOnQueue.bind(null, this);

    if (autoFetchRateLimits) {
      this.initRateLimitsAutoFetch();
    }

    if (showProgressBar) {
      this.progressBar = progressBar || createProgressBar({
        queues: this.queues,
      });
    }

    this.rateLimits = await this.getRateLimits();

    readyResolver();
  }

  createQueue(url) {
    this.queues[url] = createQueue({
      maxConcurrent: MAX_CONCURRENT_FETCH,
      retry: true,
      maxRetries: 3,
    }).on('all', () => {
      if (!this.progressBar) return;
      this.progressBar.update();
    });

    const reset = this.rateLimits[url];

    if (reset) {
      this.setRateLimitOnQueue(url, reset);
    }
  }

  async request(method, params, { noWaitForReady, retry } = {}) {
    // ex: that first rate limits request
    if (!noWaitForReady) {
      // make sure we are ready
      await this.ready;
    }

    if (!this.queues[method]) {
      this.createQueue(method);
    }

    return this.queues[method].add(async () => {
      try {
        return (await get(this.client, method)(params)).data;
      } catch (e) {
        // not found
        if (e.code === 404) return null;

        // rate limited
        if (e.code === 88) {
          // write this better
          // for now it just waits 20 seconds so that the rate limit
          // auto request can find something
          this.setRateLimitOnQueue(method, moment().add(ON_RATE_LIMIT_TIMEOUT, 'milliseconds').unix());
          return;
        }

        throw e;
      }
    }, {
      name: `${(method + (params ? ` ${JSON.stringify(params)}` : ''))}`,
      retry,
    });
  }

  initRateLimitsAutoFetch() {
    this.rateFetchTimeout = setInterval(async () => {
      this.rateLimits = await this.getRateLimits();
    }, RATE_LIMIT_AUTO_FETCH_INTERVAL);
  }

  initHelpers() {
    this.helpers = {};
  }

  close() {
    clearInterval(this.rateFetchTimeout);
    this.progressBar.removeBar();
  }
};
